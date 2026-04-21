using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.Domain;
using ModelCycle.Models;
using ModelCycle.Repositories;
using ModelCycle.Services.ImageConfidence;

namespace ModelCycle.Services.Training;

public class TrainingWorkflowService : ITrainingWorkflowService
{
    private readonly AppDbContext _db;
    private readonly IConfidenceService _confidenceService;
    private readonly IDatasetService _datasetService;
    private readonly ILogger<TrainingWorkflowService> _logger;
    private readonly TrainingJobQueue _jobQueue;
    private readonly IModelWeightsRepository _modelRepo;
    private readonly IAuthService _authService;

    public TrainingWorkflowService(
        AppDbContext db,
        IConfidenceService confidenceService,
        IDatasetService datasetService,
        TrainingJobQueue jobQueue,
        ILogger<TrainingWorkflowService> logger,
        IModelWeightsRepository modelRepo,
        IAuthService authService)
    {
        _db = db;
        _confidenceService = confidenceService;
        _datasetService = datasetService;
        _jobQueue = jobQueue;
        _logger = logger;
        _modelRepo = modelRepo;
        _authService = authService;
    }

    public async Task<ConfidenceResult> ProcessVoteAsync(EvaluateImageRequest request)
    {

        var (image, _, isNew) = await GetOrCreateImageAsync(request);

        ModelWeights? modelWeights = null;

        var userIds = request.Votes.Select(v => v.UserId).Distinct().ToList();
        var accuracyList = await _authService.GetUsersAccuracyAsync(userIds);

        var rawPostId = request.PostId ?? "NULL";
        var sanitizedPostId = rawPostId.Replace("\r", " ").Replace("\n", " ");

        _logger.LogInformation("[Diagnostic] Processing {Count} accuracy records for Post {PostId}",
            accuracyList.Count, sanitizedPostId);

        foreach (var acc in accuracyList)
        {
            _logger.LogInformation("[Diagnostic] UserID: '{Id}'", acc.UserId ?? "NULL");
        }
        var accuracyMap = accuracyList.ToDictionary(a => a.UserId);


        var weightedVotes = request.Votes.Select(v => new UserVoteWithMetrics
        {
            UserId = v.UserId,
            IsAiVote = v.IsAiVote,
            Metrics = accuracyMap.GetValueOrDefault(v.UserId) ?? new UserAccuracy { UserId = v.UserId }
        }).ToList();

        if (!string.IsNullOrEmpty(image.ModelVersion))
        {
            modelWeights = await _modelRepo.GetByVersionAsync(image.ModelVersion);
        }

        if (modelWeights == null)
        {
            _logger.LogWarning("ModelWeights not found for version '{Version}', attempting to use v1.0.0.", image.ModelVersion);
            modelWeights = await _modelRepo.GetByVersionAsync("v1.0.0");

            if (modelWeights == null)
            {
                _logger.LogError("CRITICAL: Fallback to v1.0.0 failed. No model weights found. Using hardcoded fallback.");
                modelWeights = new ModelWeights
                {
                    Version = "v0.0.0-fallback",
                    GoldenTestPrecision = 0.5,
                    GoldenTestRecall = 0.5,
                    ValidationAccuracy = 0.5,
                    ValidationPrecision = 0.5,
                    ValidationRecall = 0.5,
                    ValidationF1Score = 0.5,
                    GoldenTestAccuracy = 0.5,
                    GoldenTestF1Score = 0.5,
                    MinioObjectPath = "fallback",
                    NewImagesCount = 0,
                    ReplayBufferCount = 0,
                    GoldenFakeToRealMisclassifications = 0,
                    GoldenRealToFakeMisclassifications = 0,
                    IsDeployed = false,
                };
            }
        }

        var previousState = new PreviousImageState(image.Status, image.Label);
        UpdateImageVotes(image, request);

        var result = _confidenceService.Evaluate(new WeightedVoteData
        {
            PostId = request.PostId,
            Votes = weightedVotes,
            ModelConfidence = request.ModelConfidence,
            Label = image.Label
        }, modelWeights);

        image.CurrentProbability = result.Probability;

        await SyncFileSystemStateAsync(image, result, previousState);

        await _db.SaveChangesAsync();

        bool statusChangedToReady = result.IsReadyForTraining && previousState.Status != TrainingStatus.Ready;
        bool isNewAndReady = isNew && result.IsReadyForTraining;
        bool labelChangedWhileReady = result.IsReadyForTraining
                                    && previousState.Status == TrainingStatus.Ready
                                    && previousState.Label != result.TrainingLabel?.ToLowerInvariant();

        if (statusChangedToReady || isNewAndReady || labelChangedWhileReady)
        {
            await _jobQueue.QueueJobAsync();
            _logger.LogInformation(
                "Image {PostId} triggered training signal. (New: {IsNew}, Promoted to Ready: {Promoted}, Label Flipped: {Flipped})",
                request.PostId, isNew, statusChangedToReady, labelChangedWhileReady);
        }
        else if (result.IsReadyForTraining && previousState.Status == TrainingStatus.Ready)
        {
            _logger.LogInformation(
                "Image {PostId} is already in the dataset with the same label. Skipping training trigger.",
                request.PostId);
        }

        return result;
    }

    private async Task<(TrainingImage Image, string? DownloadUrl, bool isNew)> GetOrCreateImageAsync(EvaluateImageRequest request)
    {
        var image = await _db.TrainingImages.FirstOrDefaultAsync(i => i.MediaImageId == request.MediaImageId);
        var isNew = false;
        string? url = null;

        if (image == null)
        {
            isNew = true;
            var requestedS3Key = string.IsNullOrWhiteSpace(request.S3Key) ? null : request.S3Key.Trim();
            var requestedModelVersion = string.IsNullOrWhiteSpace(request.ModelVersion) ? null : request.ModelVersion.Trim();
            if (requestedS3Key == null || requestedModelVersion == null)
            {
                _logger.LogError("Training image metadata missing for media ID {MediaImageId}", request.MediaImageId);
                throw new Exception("Training image metadata missing");
            }

            image = new TrainingImage
            {
                Id = Guid.NewGuid(),
                PostId = request.PostId,
                MediaImageId = request.MediaImageId,
                S3Key = requestedS3Key,
                Label = NormalizeLabel(request.Label),
                UploadedAt = DateTime.UtcNow,
                Status = TrainingStatus.Pending,
                ModelVersion = requestedModelVersion,
            };
            _db.TrainingImages.Add(image);
        }
        else
        {
            if (string.IsNullOrWhiteSpace(image.S3Key) && !string.IsNullOrWhiteSpace(request.S3Key))
            {
                image.S3Key = request.S3Key.Trim();
            }

            if (string.IsNullOrWhiteSpace(image.ModelVersion) && !string.IsNullOrWhiteSpace(request.ModelVersion))
            {
                image.ModelVersion = request.ModelVersion.Trim();
            }

            if (string.IsNullOrWhiteSpace(image.Label))
            {
                image.Label = NormalizeLabel(request.Label);
            }
        }

        return (image, url, isNew);
    }

    private void UpdateImageVotes(TrainingImage image, EvaluateImageRequest request)
    {
        image.UserAiVotes = request.Votes.Count(v => v.IsAiVote);
        image.UserRealVotes = request.Votes.Count(v => !v.IsAiVote);
        image.ModelConfidenceScore = request.ModelConfidence;
    }

    private async Task SyncFileSystemStateAsync(
        TrainingImage image,
        ConfidenceResult result,
        PreviousImageState previousState)
    {
        bool isNowReady = result.IsReadyForTraining;
        bool wasReady = previousState.Status == TrainingStatus.Ready;

        if (isNowReady)
        {
            image.Status = TrainingStatus.Ready;
            image.Label = result.TrainingLabel?.ToLowerInvariant();

            if (!string.IsNullOrEmpty(image.S3Key))
            {
                try
                {
                    await _datasetService.SaveImageAsync(image.MediaImageId, image.S3Key);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to download image {MediaId}", image.MediaImageId);
                    image.Status = TrainingStatus.Pending;
                    throw;
                }
            }
        }
        else
        {
            if (wasReady)
            {
                await _datasetService.DeleteImageAsync(image.MediaImageId);
                image.Status = TrainingStatus.Pending;
            }
        }
    }

    private record PreviousImageState(TrainingStatus Status, string? Label);

    private static string NormalizeLabel(string? label)
    {
        return string.IsNullOrWhiteSpace(label) ? "unknown" : label.Trim().ToLowerInvariant();
    }
}