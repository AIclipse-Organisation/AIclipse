using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.Domain;
using ModelCycle.Models;
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

    public TrainingWorkflowService(
        AppDbContext db,
        IConfidenceService confidenceService,
        IMediaService mediaService,
        IDatasetService datasetService,
        TrainingJobQueue jobQueue,
        ILogger<TrainingWorkflowService> logger)
    {
        _db = db;
        _confidenceService = confidenceService;
        _mediaService = mediaService;
        _datasetService = datasetService;
        _jobQueue = jobQueue;
        _logger = logger;
    }

    public async Task<ConfidenceResult> ProcessVoteAsync(EvaluateImageRequest request)
    {
        var (image, downloadUrl) = await GetOrCreateImageAsync(request);
        
        var previousState = new PreviousImageState(image.Status, image.Label);
        
        UpdateImageVotes(image, request);
        
        var result = _confidenceService.Evaluate(new VoteData
        {
            PostId = request.PostId,
            UserAiVotes = request.UserAiVotes,
            UserNotAiVotes = request.UserNotAiVotes,
            ModelConfidence = request.ModelConfidence
        });
        
        image.CurrentProbability = result.Probability;
        
        await SyncFileSystemStateAsync(image, result, previousState);
        
        await _db.SaveChangesAsync();
        
        if (result.IsReadyForTraining)
        {
            // call's background worker and returns immediately.
            await _jobQueue.QueueJobAsync();
            _logger.LogInformation("Training signal queued.");
        }
        
        return result;
    }

    private async Task<(TrainingImage Image, string? DownloadUrl)> GetOrCreateImageAsync(EvaluateImageRequest request)
    {
        var image = await _db.TrainingImages.FirstOrDefaultAsync(i => i.MediaImageId == request.MediaImageId);
        string? url = null;

        if (image == null)
        {
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
                Label = request.Label,
                UploadedAt = DateTime.UtcNow,
                Status = TrainingStatus.Pending
            };
            _db.TrainingImages.Add(image);
            url = mediaMetadata.Url;
        }

        return (image, url);
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
            image.Label = result.TrainingLabel;
            
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

    private record PreviousImageState(TrainingStatus Status, string Label);
}