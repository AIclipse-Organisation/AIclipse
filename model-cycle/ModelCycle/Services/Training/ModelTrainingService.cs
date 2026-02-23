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
    private readonly ILogger<ModelTrainingService> _logger;
    private readonly ModelCycleConfig _config;

    public ModelTrainingService(
        AppDbContext context,
        ITrainingJobManager jobManager,
        IPythonExecutor pythonExecutor,
        IBlobStorageService blobStorage,
        ILogger<ModelTrainingService> logger,
        IOptions<ModelCycleConfig> config)
    {
        _context = context;
        _jobManager = jobManager;
        _pythonExecutor = pythonExecutor;
        _blobStorage = blobStorage;
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

            _logger.LogInformation("Uploading trained model...");
            string s3ModelPath = await UploadModelToMinioAsync(jobScope, nextVersion);

            return await ProcessTrainingResults(jobScope, newImages, replayImages, s3ModelPath, nextVersion);
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
            .CountAsync(t => t.Status == TrainingStatus.Ready && t.Label == "real");

        var readyAiCount = await _context.TrainingImages
            .CountAsync(t => t.Status == TrainingStatus.Ready && t.Label == "ai");

        var batchSizePerClass = Math.Min(readyRealCount, readyAiCount);

        _logger.LogInformation("Balancing Dataset: Found {Real} Real, {Ai} AI. Limiting to {Limit} per class.",
            readyRealCount, readyAiCount, batchSizePerClass);

        if (batchSizePerClass < 1)
        {
            return (new List<TrainingImage>(), new List<TrainingImage>());
        }

        var newReal = await _context.TrainingImages
            .Where(t => t.Status == TrainingStatus.Ready && t.Label == "real")
            .OrderBy(t => EF.Functions.Random())
            .Take(batchSizePerClass)
            .ToListAsync();

        var newAi = await _context.TrainingImages
            .Where(t => t.Status == TrainingStatus.Ready && t.Label == "ai")
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

    private async Task<string> UploadModelToMinioAsync(TrainingJobManager.JobScope scope, string version)
    {
        var expectedFile = "pytorch_model.bin";
        var modelPath = Path.Combine(scope.OutputDir, expectedFile);

        if (!File.Exists(modelPath))
        {
            var altPath = Path.Combine(scope.OutputDir, "model.safetensors");
            if (File.Exists(altPath))
            {
                modelPath = altPath;
                expectedFile = "model.safetensors";
            }
            else
            {
                _logger.LogError("Expected model file not found at {Path}", modelPath);
                throw new FileNotFoundException($"Python did not produce a {expectedFile} file");
            }
        }

        var fileName = $"{version}.pt";

        _logger.LogInformation("Uploading {LocalFile} to MinIO as {RemoteFile}...", expectedFile, fileName);

        using var stream = File.OpenRead(modelPath);
        return await _blobStorage.UploadFileAsync(stream, "models", fileName, "application/octet-stream");
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

    private async Task<Guid> ProcessTrainingResults(
        TrainingJobManager.JobScope scope,
        List<TrainingImage> newImages,
        List<TrainingImage> replayImages,
        string s3ModelPath,
        string version)
    {
        if (!File.Exists(scope.MetricsPath))
            throw new FileNotFoundException("Metrics file not found");

        var json = await File.ReadAllTextAsync(scope.MetricsPath);
        var results = JsonSerializer.Deserialize<PythonTrainingResult>(json)
                      ?? throw new InvalidOperationException("Failed to deserialize metrics json.");

        var weights = new ModelWeights
        {
            Id = Guid.NewGuid(),
            Version = version,
            CreatedAt = DateTime.UtcNow,
            MinioObjectPath = s3ModelPath,

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

        if (isImproved)
        {
            weights.IsDeployed = true;
            if (currentModel != null) currentModel.IsDeployed = false;

            foreach (var img in newImages)
            {
                img.Status = TrainingStatus.UsedInTraining;
                weights.ImageLinks.Add(new ModelImageLink
                {
                    TrainingImageId = img.Id,
                    UsageType = ImageUsageType.NewTraining
                });
            }

            foreach (var img in replayImages)
            {
                weights.ImageLinks.Add(new ModelImageLink
                {
                    TrainingImageId = img.Id,
                    UsageType = ImageUsageType.Replay
                });
            }
        }
        else
        {
            weights.IsDeployed = false;
        }

        _context.ModelWeights.Add(weights);
        await _context.SaveChangesAsync();

        return weights.Id;
    }
}