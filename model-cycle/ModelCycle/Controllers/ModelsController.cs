using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.DTOs;
using ModelCycle.Models;
using ModelCycle.Services;
using ModelCycle.Security;
using ModelCycle.Services.Training;

namespace ModelCycle.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ModelsController : ControllerBase
{
    private readonly IBlobStorageService _blobService;
    private readonly AppDbContext _dbContext;
    private readonly TrainingJobQueue _jobQueue;
    private readonly IModelDeploymentService _deploymentService;
    private readonly IInternalRequestAuthorizer _requestAuthorizer;

    public ModelsController(
    IBlobStorageService blobService,
    AppDbContext dbContext,
    TrainingJobQueue jobQueue,
    IModelDeploymentService deploymentService,
    IInternalRequestAuthorizer requestAuthorizer)
    {
        _blobService = blobService;
        _dbContext = dbContext;
        _jobQueue = jobQueue;
        _deploymentService = deploymentService;
        _requestAuthorizer = requestAuthorizer;
    }

    [HttpPost("train")]
    public async Task<IActionResult> TriggerManualTraining()
    {
        var authFailure = _requestAuthorizer.RequireForwardedAdmin(Request);
        if (authFailure != null)
        {
            return authFailure;
        }

        await _jobQueue.QueueJobAsync();

        return Accepted(new { Message = "Training signal sent to background queue." });
    }

    [HttpGet("/images")]
    public async Task<IActionResult> GetModelImages()
    {
        var authFailure = _requestAuthorizer.RequireForwardedAdmin(Request);
        if (authFailure != null)
        {
            return authFailure;
        }

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
        var authFailure = _requestAuthorizer.RequireForwardedAdmin(Request);
        if (authFailure != null)
        {
            return authFailure;
        }

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

    [HttpPost("uploads")]
    public async Task<IActionResult> CreateUploadSession(
        [FromBody] CreateModelUploadSessionRequest request,
        [FromHeader(Name = "X-External-Proto")] string? xExternalProto)
    {
        var authFailure = _requestAuthorizer.RequireForwardedAdmin(Request);
        if (authFailure != null)
        {
            return authFailure;
        }

        try
        {
            var session = await _deploymentService.CreateUploadSessionAsync(request, xExternalProto);
            return Ok(session);
        }
        catch (ModelUploadException ex)
        {
            return StatusCode(ex.StatusCode, new { detail = ex.Message });
        }
    }

    [HttpPost("uploads/finalize")]
    public async Task<IActionResult> FinalizeUpload([FromBody] FinalizeModelUploadRequest request)
    {
        var authFailure = _requestAuthorizer.RequireForwardedAdmin(Request);
        if (authFailure != null)
        {
            return authFailure;
        }

        try
        {
            var deployedModel = await _deploymentService.FinalizeUploadedModelAsync(request);
            var linkedImages = (request.NewTrainingImageIds?.Count ?? 0)
                               + (request.ReplayImageIds?.Count ?? 0)
                               + (request.GoldenTestImageIds?.Count ?? 0);

            return Ok(new
            {
                Message = "Model uploaded, deployed, and lineage tracked.",
                Id = deployedModel.Id,
                Version = deployedModel.Version,
                ImagesLinked = linkedImages,
            });
        }
        catch (ModelUploadException ex)
        {
            return StatusCode(ex.StatusCode, new { detail = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetModels()
    {
        var authFailure = _requestAuthorizer.RequireForwardedAdmin(Request);
        if (authFailure != null)
        {
            return authFailure;
        }

        var models = await _dbContext.ModelWeights
            .OrderByDescending(m => m.CreatedAt)
            .AsNoTracking()
            .ToListAsync();

        return Ok(models);
    }


    [HttpDelete("{version}")]
    public async Task<IActionResult> DeleteModel(string version)
    {
        var authFailure = _requestAuthorizer.RequireForwardedAdmin(Request);
        if (authFailure != null)
        {
            return authFailure;
        }

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
                await _blobService.DeleteFileAsync(model.MinioObjectPath);
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