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

    public TrainingWorkflowService(
        AppDbContext db,
        IConfidenceService confidenceService,
        IMediaService mediaService,
        IDatasetService datasetService,
        ILogger<TrainingWorkflowService> logger)
    {
        _db = db;
        _confidenceService = confidenceService;
        _mediaService = mediaService;
        _datasetService = datasetService;
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
        
        await SyncFileSystemStateAsync(image, result, previousState, downloadUrl);
        
        await _db.SaveChangesAsync();
        
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
                _logger.LogError("Media ID {MediaId} not found in Media Service", request.MediaImageId);
                throw new Exception($"Image {request.MediaImageId} not found in Media Module");
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
        PreviousImageState previousState, 
        string? downloadUrl)
    {
        bool isNowReady = result.IsReadyForTraining;
        bool wasReady = previousState.Status == TrainingStatus.Ready;

        if (isNowReady)
        {
            image.Status = TrainingStatus.Ready;
            image.Label = result.TrainingLabel;
            
            string? url = downloadUrl;
            if (string.IsNullOrEmpty(url))
            {
                var meta = await _mediaService.GetImageMetadataAsync(image.MediaImageId);
                url = meta?.Url;
            }

            if (!string.IsNullOrEmpty(url))
            {
                try
                {
                    await _datasetService.SaveImageAsync(image.MediaImageId, url);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to download image {MediaId} to training set", image.MediaImageId);
                    image.Status = TrainingStatus.Pending;
                    throw; 
                }
            }
        }
        else
        {
            if (wasReady)
            {
                _logger.LogInformation("Demoting image {MediaId} (Confidence dropped)", image.MediaImageId);
                await _datasetService.DeleteImageAsync(image.MediaImageId);
                image.Status = TrainingStatus.Pending;
            }
        }
    }

    private record PreviousImageState(TrainingStatus Status, string Label);
}