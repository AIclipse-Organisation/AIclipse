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
    private readonly IMediaService _mediaService;
    private readonly IDatasetService _datasetService;
    private readonly ILogger<TrainingWorkflowService> _logger;
    private readonly TrainingJobQueue _jobQueue;
    private readonly IModelWeightsRepository _modelRepo;
    private readonly IAuthService _authService;

    public TrainingWorkflowService(
        AppDbContext db,
        IConfidenceService confidenceService,
        IMediaService mediaService,
        IDatasetService datasetService,
        TrainingJobQueue jobQueue,
        ILogger<TrainingWorkflowService> logger,
        IModelWeightsRepository modelRepo,
        IAuthService authService)
    {
        _db = db;
        _confidenceService = confidenceService;
        _mediaService = mediaService;
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
            if (!string.IsNullOrEmpty(image.ModelVersion))
            {
                modelWeights = await _modelRepo.GetByVersionAsync(image.ModelVersion);
            }

            if (modelWeights == null)
            {
                modelWeights = await _modelRepo.GetDeployedModelAsync();
            }

            if (modelWeights == null)
            {
                throw new InvalidOperationException($"No ModelWeights found for version '{image.ModelVersion}' and no default deployed model exists.");
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

        if (statusChangedToReady || isNewAndReady)
        {
            await _jobQueue.QueueJobAsync();
            _logger.LogInformation(
                "Image {PostId} promoted to Ready (New: {IsNew}). Training signal queued.",
                request.PostId, isNew);
        }
        else if (result.IsReadyForTraining && previousState.Status == TrainingStatus.Ready)
        {
            _logger.LogInformation(
                "Image {PostId} is already in the dataset (Status: Ready). Skipping training trigger.",
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
            var mediaMetadata = await _mediaService.GetImageMetadataAsync(request.MediaImageId);
            if (mediaMetadata == null)
            {
                _logger.LogError("Media ID not found in Media Service");
                throw new Exception($"Image not found in Media Module");
            }

            image = new TrainingImage
            {
                Id = Guid.NewGuid(),
                PostId = request.PostId,
                MediaImageId = mediaMetadata.ImageId,
                S3Key = mediaMetadata.S3Key,
                Label = request.Label?.ToLowerInvariant(),
                UploadedAt = DateTime.UtcNow,
                Status = TrainingStatus.Pending,
                ModelVersion = mediaMetadata.ModelVersion,
            };
            _db.TrainingImages.Add(image);
            url = mediaMetadata.Url;
        }

        return (image, url, isNew);
    }

    private void UpdateImageVotes(TrainingImage image, EvaluateImageRequest request)
    {
        image.UserAiVotes = request.UserAiVotes;
        image.UserRealVotes = request.UserNotAiVotes;
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
}