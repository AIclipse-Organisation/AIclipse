using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.Models;

namespace ModelCycle.Services;

public class ModelDeploymentService : IModelDeploymentService
{
    private readonly AppDbContext _dbContext;
    private readonly IBlobStorageService _blobService;
    private readonly IDetectorClientService _detectorClient;
    private readonly ILogger<ModelDeploymentService> _logger;

    public ModelDeploymentService(
        AppDbContext dbContext,
        IBlobStorageService blobService,
        IDetectorClientService detectorClient,
        ILogger<ModelDeploymentService> logger)
    {
        _dbContext = dbContext;
        _blobService = blobService;
        _detectorClient = detectorClient;
        _logger = logger;
    }

    public async Task<ModelWeights> UploadAndDeployModelAsync(
        Stream modelStream,
        string fileName,
        string contentType,
        ModelWeights newModelWeights,
        List<ModelImageLink> imageLinks)
    {
        _logger.LogInformation("Uploading model {FileName} to MinIO...", fileName);
        var minioPath = await _blobService.UploadFileAsync(modelStream, "models", fileName, contentType);

        newModelWeights.MinioObjectPath = minioPath;
        newModelWeights.IsDeployed = true;
        newModelWeights.CreatedAt = DateTime.UtcNow;
        newModelWeights.ImageLinks = imageLinks;

        var currentlyDeployed = await _dbContext.ModelWeights
            .Where(m => m.IsDeployed)
            .ToListAsync();

        foreach (var model in currentlyDeployed)
        {
            model.IsDeployed = false;
        }

        _dbContext.ModelWeights.Add(newModelWeights);
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Notifying Detector of new model version {Version}...", newModelWeights.Version);
        await _detectorClient.NotifyModelUpdateAsync(newModelWeights.Version, minioPath);

        return newModelWeights;
    }
}