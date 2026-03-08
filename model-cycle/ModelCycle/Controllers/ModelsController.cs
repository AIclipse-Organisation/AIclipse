using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.DTOs;
using ModelCycle.Models;
using ModelCycle.Services;
using ModelCycle.Services.Training;

namespace ModelCycle.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ModelsController : ControllerBase
{
    private readonly BlobStorageService _blobService;
    private readonly AppDbContext _dbContext;
    private readonly TrainingJobQueue _jobQueue;

    private readonly IModelDeploymentService _deploymentService;

    public ModelsController(
    BlobStorageService blobService,
    AppDbContext dbContext,
    TrainingJobQueue jobQueue,
    IModelDeploymentService deploymentService)
    {
        _blobService = blobService;
        _dbContext = dbContext;
        _jobQueue = jobQueue;
        _deploymentService = deploymentService;
    }

    [HttpPost("train")]
    public async Task<IActionResult> TriggerManualTraining()
    {
        await _jobQueue.QueueJobAsync();

        return Accepted(new { Message = "Training signal sent to background queue." });
    }

    [HttpGet("/images")]
    public async Task<IActionResult> GetModelImages()
    {
        var images = await _dbContext.TrainingImages
            .AsNoTracking()
            .OrderByDescending(i => i.UploadedAt)
            .Select(i => new
            {
                i.Id,
                i.MediaImageId,
                i.S3Key,
                i.Label,
                i.Status,
                i.UploadedAt,
                i.UserAiVotes,
                i.UserRealVotes,
                i.ModelConfidenceScore,
                i.ModelVersion
            })
            .ToListAsync();

        return Ok(images);
    }

    [HttpGet("current")]
    public async Task<IActionResult> GetCurrentModel()
    {
        var activeModel = await _dbContext.ModelWeights
            .AsNoTracking()
            .Where(m => m.IsDeployed)
            .OrderByDescending(m => m.CreatedAt)
            .FirstOrDefaultAsync();

        if (activeModel == null)
        {
            return NotFound("No deployed model found.");
        }

        return Ok(new
        {
            Version = activeModel.Version,
            Accuracy = activeModel.GoldenTestAccuracy,
            Precision = activeModel.GoldenTestPrecision,
            Recall = activeModel.GoldenTestRecall,
            DeployedAt = activeModel.CreatedAt
        });
    }

    [HttpPost("upload")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> UploadModel([FromForm] UploadModelRequest request)
    {
        if (request.File == null || request.File.Length == 0)
            return BadRequest("No file provided.");

        var modelId = Guid.NewGuid();
        var modelWeight = new ModelWeights
        {
            Id = modelId,
            Version = request.Version,
            NewImagesCount = request.NewImagesCount,
            ReplayBufferCount = request.ReplayBufferCount,
            ValidationAccuracy = request.ValidationAccuracy,
            ValidationPrecision = request.ValidationPrecision,
            ValidationRecall = request.ValidationRecall,
            ValidationF1Score = request.ValidationF1Score,
            GoldenTestAccuracy = request.GoldenTestAccuracy,
            GoldenTestPrecision = request.GoldenTestPrecision,
            GoldenTestRecall = request.GoldenTestRecall,
            GoldenTestF1Score = request.GoldenTestF1Score,
            GoldenFakeToRealMisclassifications = request.GoldenFakeToRealMisclassifications,
            GoldenRealToFakeMisclassifications = request.GoldenRealToFakeMisclassifications
        };

        var links = new List<ModelImageLink>();

        void AddLinks(List<Guid>? ids, ImageUsageType usage)
        {
            if (ids == null) return;
            foreach (var imgId in ids)
            {
                links.Add(new ModelImageLink
                {
                    ModelWeightId = modelId,
                    TrainingImageId = imgId,
                    UsageType = usage
                });
            }
        }

        AddLinks(request.NewTrainingImageIds, ImageUsageType.NewTraining);
        AddLinks(request.ReplayImageIds, ImageUsageType.Replay);
        AddLinks(request.GoldenTestImageIds, ImageUsageType.GoldenTest);

        var extension = Path.GetExtension(request.File.FileName);
        var fileName = $"{request.Version}{extension}";

        using var stream = request.File.OpenReadStream();
        var deployedModel = await _deploymentService.UploadAndDeployModelAsync(
            stream,
            fileName,
            request.File.ContentType,
            modelWeight,
            links
        );

        return Ok(new
        {
            Message = "Model uploaded, deployed, and lineage tracked.",
            Id = deployedModel.Id,
            Version = deployedModel.Version,
            ImagesLinked = links.Count
        });
    }


    [HttpGet]
    public async Task<IActionResult> GetModels()
    {
        var models = await _dbContext.ModelWeights
            .OrderByDescending(m => m.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return Ok(models);
    }


    [HttpDelete("{version}")]
    public async Task<IActionResult> DeleteModel(string version)
    {
        if (!version.StartsWith("v", StringComparison.OrdinalIgnoreCase))
        {
            version = $"v{version}";
        }

        var model = await _dbContext.ModelWeights
            .FirstOrDefaultAsync(m => m.Version == version);

        if (model == null)
        {
            return NotFound($"Model version '{version}' not found.");
        }

        if (_blobService != null && !string.IsNullOrEmpty(model.MinioObjectPath))
        {
            try
            {
                var fileName = Path.GetFileName(model.MinioObjectPath);
                if (!string.IsNullOrEmpty(fileName))
                {
                    await _blobService.DeleteFileAsync("models", fileName);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Warning] Could not delete file from MinIO: {ex.Message}");
            }
        }

        _dbContext.ModelWeights.Remove(model);
        await _dbContext.SaveChangesAsync();

        return Ok(new { Message = $"Model {version} deleted successfully." });
    }
}