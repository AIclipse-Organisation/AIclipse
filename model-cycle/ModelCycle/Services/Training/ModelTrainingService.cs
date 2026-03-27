using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ModelCycle.Data;
using ModelCycle.DTOs;
using ModelCycle.DTOs.ModelTraining;
using ModelCycle.Models;

namespace ModelCycle.Services.Training;

public class ModelTrainingService : IModelTrainingService
{
    private readonly AppDbContext _context;
    private readonly ITrainingJobManager _jobManager;
    private readonly IPythonExecutor _pythonExecutor;
    private readonly IBlobStorageService _blobStorage;
    private readonly IModelDeploymentService _deploymentService;
    private readonly ILogger<ModelTrainingService> _logger;
    private readonly ModelCycleConfig _config;

    public ModelTrainingService(
        AppDbContext context,
        ITrainingJobManager jobManager,
        IPythonExecutor pythonExecutor,
        IBlobStorageService blobStorage,
        IModelDeploymentService deploymentService,
        ILogger<ModelTrainingService> logger,
        IOptions<ModelCycleConfig> config)
    {
        _context = context;
        _jobManager = jobManager;
        _pythonExecutor = pythonExecutor;
        _blobStorage = blobStorage;
        _deploymentService = deploymentService;
        _logger = logger;
        _config = config.Value;
    }

    public async Task<Guid?> RunTrainingCycleAsync()
    {
        var (newImages, replayImages) = await GetTrainingData();

        if (newImages.Count < _config.BatchSizeThreshold)
        {
            _logger.LogWarning("Insufficient balanced data found. Aborting.");
            return null;
        }

        _logger.LogInformation("Sufficient data. Starting training");
        using var jobScope = _jobManager.CreateJobScope();

        try
        {
            _logger.LogInformation("Initializing training Job {Id}...", jobScope.JobId);

            await _jobManager.StageImagesAsync(jobScope, newImages, replayImages);
            string baseModelPath = await _jobManager.PrepareBaseModelAsync(jobScope);

            _logger.LogInformation("Starting Python training...");
            var success = await _pythonExecutor.RunTrainingAsync(jobScope, baseModelPath);

            if (!success) return null;

            string nextVersion = await GetNextVersionStringAsync();
            _logger.LogInformation("New model version will be: {Version}", nextVersion);

            return await EvaluateAndProcessModelAsync(jobScope, newImages, replayImages, nextVersion);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Training Job {Id} failed critically.", jobScope.JobId);
            return null;
        }
    }

    private async Task<(List<TrainingImage> NewImages, List<TrainingImage> ReplayImages)> GetTrainingData()
    {
        var readyRealCount = await _context.TrainingImages
            .CountAsync(t => t.Status == TrainingStatus.Ready && t.Label.ToLower() == "real");

        var readyAiCount = await _context.TrainingImages
            .CountAsync(t => t.Status == TrainingStatus.Ready && t.Label.ToLower() == "ai");

        var batchSizePerClass = Math.Min(readyRealCount, readyAiCount);

        _logger.LogInformation("Balancing Dataset: Found {Real} Real, {Ai} AI. Limiting to {Limit} per class.",
            readyRealCount, readyAiCount, batchSizePerClass);

        if (batchSizePerClass < 1)
        {
            return (new List<TrainingImage>(), new List<TrainingImage>());
        }

        var newReal = await _context.TrainingImages
            .Where(t => t.Status == TrainingStatus.Ready && t.Label.ToLower() == "real")
            .OrderBy(t => EF.Functions.Random())
            .Take(batchSizePerClass)
            .ToListAsync();

        var newAi = await _context.TrainingImages
            .Where(t => t.Status == TrainingStatus.Ready && t.Label.ToLower() == "ai")
            .OrderBy(t => EF.Functions.Random())
            .Take(batchSizePerClass)
            .ToListAsync();

        var newImages = newReal.Concat(newAi).ToList();

        int replayCount = 20;

        var replayImages = await _context.TrainingImages
            .Where(t => t.Status == TrainingStatus.UsedInTraining)
            .OrderBy(t => EF.Functions.Random())
            .Take(replayCount)
            .ToListAsync();

        return (newImages, replayImages);
    }

    private async Task<string> GetNextVersionStringAsync()
    {
        var allVersions = await _context.ModelWeights
            .Select(m => m.Version)
            .ToListAsync();

        int maxVer = 0;
        foreach (var v in allVersions)
        {
            if (!string.IsNullOrEmpty(v) && v.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            {
                if (int.TryParse(v.Substring(1), out int val))
                {
                    if (val > maxVer) maxVer = val;
                }
            }
        }

        return $"v{maxVer + 1}";
    }

    private string GetModelFilePath(TrainingJobManager.JobScope scope, out string expectedFileName)
    {
        expectedFileName = "pytorch_model.bin";
        var modelPath = Path.Combine(scope.OutputDir, expectedFileName);

        if (!File.Exists(modelPath))
        {
            var altPath = Path.Combine(scope.OutputDir, "model.safetensors");
            if (File.Exists(altPath))
            {
                modelPath = altPath;
                expectedFileName = "model.safetensors";
            }
            else
            {
                _logger.LogError("Expected model file not found at {Path}", modelPath);
                throw new FileNotFoundException($"Python did not produce a valid model file");
            }
        }
        return modelPath;
    }

    private async Task<Guid> EvaluateAndProcessModelAsync(
        TrainingJobManager.JobScope scope,
        List<TrainingImage> newImages,
        List<TrainingImage> replayImages,
        string version)
    {
        if (!File.Exists(scope.MetricsPath))
            throw new FileNotFoundException("Metrics file not found");

        var json = await File.ReadAllTextAsync(scope.MetricsPath);
        var results = JsonSerializer.Deserialize<PythonTrainingResult>(json)
                      ?? throw new InvalidOperationException("Failed to deserialize metrics json.");

        var modelId = Guid.NewGuid();
        var weights = new ModelWeights
        {
            Id = modelId,
            Version = version,
            NewImagesCount = newImages.Count,
            ReplayBufferCount = replayImages.Count,
            ValidationAccuracy = results.Validation.Accuracy,
            ValidationPrecision = results.Validation.Precision,
            ValidationRecall = results.Validation.Recall,
            ValidationF1Score = results.Validation.F1Score,
            GoldenTestAccuracy = results.GoldenTest.Accuracy,
            GoldenTestPrecision = results.GoldenTest.Precision,
            GoldenTestRecall = results.GoldenTest.Recall,
            GoldenTestF1Score = results.GoldenTest.F1Score,
            GoldenFakeToRealMisclassifications = results.GoldenTest.MisclassFakeToReal,
            GoldenRealToFakeMisclassifications = results.GoldenTest.MisclassRealToFake
        };

        var currentModel = await _context.ModelWeights
            .Where(m => m.IsDeployed)
            .OrderByDescending(m => m.CreatedAt)
            .FirstOrDefaultAsync();

        bool isImproved = true;
        if (currentModel != null)
        {
            if (weights.GoldenTestAccuracy < (currentModel.GoldenTestAccuracy - 0.01))
            {
                isImproved = false;
                weights.RejectionReason = "Golden Test Accuracy dropped significantly.";
            }
        }

        var links = new List<ModelImageLink>();
        foreach (var img in newImages)
        {
            links.Add(new ModelImageLink { ModelWeightId = modelId, TrainingImageId = img.Id, UsageType = ImageUsageType.NewTraining });
        }
        foreach (var img in replayImages)
        {
            links.Add(new ModelImageLink { ModelWeightId = modelId, TrainingImageId = img.Id, UsageType = ImageUsageType.Replay });
        }

        var localModelPath = GetModelFilePath(scope, out var originalExtension);
        var uploadFileName = $"{version}{Path.GetExtension(originalExtension)}";
        using var stream = File.OpenRead(localModelPath);

        if (isImproved)
        {
            _logger.LogInformation("Model improved. Triggering active deployment pipeline...");

            foreach (var img in newImages)
            {
                img.Status = TrainingStatus.UsedInTraining;
            }

            await _deploymentService.UploadAndDeployModelAsync(
                stream,
                uploadFileName,
                "application/octet-stream",
                weights,
                links
            );
        }
        else
        {
            _logger.LogInformation("Model rejected. Uploading to storage for auditing purposes only...");

            weights.IsDeployed = false;
            weights.CreatedAt = DateTime.UtcNow;
            weights.ImageLinks = links;
            weights.MinioObjectPath = await _blobStorage.UploadFileAsync(stream, "models", uploadFileName, "application/octet-stream");

            _context.ModelWeights.Add(weights);
            await _context.SaveChangesAsync();
        }

        return weights.Id;
    }
}