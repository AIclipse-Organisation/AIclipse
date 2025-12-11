using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.DTOs;
using ModelCycle.Models;
using ModelCycle.Services;

namespace ModelCycle.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ModelsController : ControllerBase
{
    private readonly BlobStorageService _blobService;
    private readonly AppDbContext _dbContext;

    public ModelsController(BlobStorageService blobService, AppDbContext dbContext)
    {
        _blobService = blobService;
        _dbContext = dbContext;
    }

    [HttpPost("upload")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> UploadModel([FromForm] UploadModelRequest request)
    {
        if (request.File == null || request.File.Length == 0)
            return BadRequest("No file provided.");
        
        var extension = Path.GetExtension(request.File.FileName);
        var fileName = $"{request.Version}{extension}"; 
        
        var minioPath = await _blobService.UploadFileAsync(
            request.File.OpenReadStream(), 
            "models", 
            fileName, 
            request.File.ContentType
        );
        
        var modelId = Guid.NewGuid();
        var modelWeight = new ModelWeights
        {
            Id = modelId,
            Version = request.Version,
            MinioObjectPath = minioPath,
            CreatedAt = DateTime.UtcNow,
            
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
            GoldenRealToFakeMisclassifications = request.GoldenRealToFakeMisclassifications,
            
            IsDeployed = true, 
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

        modelWeight.ImageLinks = links;
        
        _dbContext.ModelWeights.Add(modelWeight);
        await _dbContext.SaveChangesAsync();

        return Ok(new 
        { 
            Message = "Model uploaded with lineage data", 
            Id = modelWeight.Id, 
            ImagesLinked = links.Count 
        });
    }

    [HttpGet]
    public async Task<IActionResult> GetModels()
    {
        var models = await _dbContext.ModelWeights
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync();
            
        return Ok(models);
    }
}