using System.Text.Json;
using Microsoft.EntityFrameworkCore;
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

    private const int BATCH_SIZE_THRESHOLD = 4; // these numbers will likely be grabbed from secrets, to allow for easy adjustments when testing later
    private const double REPLAY_BUFFER_RATIO = 0.20;// these numbers will likely be grabbed from secrets, to allow for easy adjustments when testing later

    public ModelTrainingService(
        AppDbContext context,
        ITrainingJobManager jobManager,
        IPythonExecutor pythonExecutor,
        IBlobStorageService blobStorage,
        ILogger<ModelTrainingService> logger)
    {
        _context = context;
        _jobManager = jobManager;
        _pythonExecutor = pythonExecutor;
        _blobStorage = blobStorage;
        _logger = logger;
    }

    public async Task<Guid?> RunTrainingCycleAsync()
    {
        var (newImages, replayImages) = await GetTrainingData();

        if (newImages.Count < BATCH_SIZE_THRESHOLD)
        {
            _logger.LogWarning("Insufficient balanced data found. Aborting.");
            return null;
        }

        using var jobScope = _jobManager.CreateJobScope();

        try
        {
            _logger.LogInformation("Initializing training Job {Id}...", jobScope.JobId);

            await _jobManager.StageImagesAsync(jobScope, newImages, replayImages);
            string baseModelPath = await _jobManager.PrepareBaseModelAsync(jobScope);

            _logger.LogInformation("Starting Python training...");
            var success = await _pythonExecutor.RunTrainingAsync(jobScope, baseModelPath);

            if (!success) return null;

            _logger.LogInformation("Uploading trained model...");
            string s3ModelPath = await UploadModelToMinioAsync(jobScope);

            return await ProcessTrainingResults(jobScope, newImages, replayImages, s3ModelPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Training Job {Id} failed critically.", jobScope.JobId);
            return null;
        }
    }

    private async Task<(List<TrainingImage> New, List<TrainingImage> Replay)> GetTrainingData()
    {
        int targetPerClass = BATCH_SIZE_THRESHOLD / 2;

        var readyReal = await _context.TrainingImages
            .Where(i => i.Status == TrainingStatus.Ready && i.Label == "Real")
            .Take(targetPerClass)
            .ToListAsync();

        var readyFake = await _context.TrainingImages
            .Where(i => i.Status == TrainingStatus.Ready && i.Label == "Fake")
            .Take(targetPerClass)
            .ToListAsync();

        _logger.LogInformation(
            "Training Data Check: Real: {RealCount}/{Target}, Fake: {FakeCount}/{Target}. (Threshold: {Total})",
            readyReal.Count, targetPerClass, readyFake.Count, targetPerClass, BATCH_SIZE_THRESHOLD
        );

        if (readyReal.Count < targetPerClass || readyFake.Count < targetPerClass)
        {
            return (new List<TrainingImage>(), new List<TrainingImage>());
        }

        var newImages = readyReal.Concat(readyFake).ToList();

        int replayTotal = (int)(BATCH_SIZE_THRESHOLD * REPLAY_BUFFER_RATIO);
        int replayHalf = replayTotal / 2;

        var realReplay = await _context.TrainingImages
            .Where(i => i.Status == TrainingStatus.UsedInTraining && i.Label == "Real")
            .OrderBy(x => Guid.NewGuid())
            .Take(replayHalf)
            .ToListAsync();

        var fakeReplay = await _context.TrainingImages
            .Where(i => i.Status == TrainingStatus.UsedInTraining && i.Label == "Fake")
            .OrderBy(x => Guid.NewGuid())
            .Take(replayHalf)
            .ToListAsync();

        var replayImages = realReplay.Concat(fakeReplay).ToList();

        return (newImages, replayImages);
    }

    private async Task<string> UploadModelToMinioAsync(TrainingJobManager.JobScope scope)
    {
        if (!File.Exists(scope.OutputModelPath))
            throw new FileNotFoundException("Python did not produce a model.safetensors file");

        using var stream = new FileStream(scope.OutputModelPath, FileMode.Open, FileAccess.Read);

        return await _blobStorage.UploadFileAsync(
            stream,
            $"models/{scope.JobId}",
            "model.safetensors",
            "application/octet-stream"
        );
    }

    private async Task<Guid> ProcessTrainingResults(
        TrainingJobManager.JobScope scope,
        List<TrainingImage> newImages,
        List<TrainingImage> replayImages,
        string s3ModelPath)
    {
        if (!File.Exists(scope.MetricsPath))
            throw new FileNotFoundException("Metrics file not found");

        var json = await File.ReadAllTextAsync(scope.MetricsPath);
        var results = JsonSerializer.Deserialize<PythonTrainingResult>(json)
                      ?? throw new InvalidOperationException("Failed to deserialize metrics json.");

        var weights = new ModelWeights
        {
            Id = Guid.NewGuid(),
            Version = $"v_{DateTime.UtcNow:yyyyMMdd}_{scope.JobId.ToString().Substring(0, 4)}",
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