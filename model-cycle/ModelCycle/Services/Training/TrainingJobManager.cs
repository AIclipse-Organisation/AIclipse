using ModelCycle.Data;
using ModelCycle.Models;

namespace ModelCycle.Services.Training;

using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.Models;
using ModelCycle.Services; 

public class TrainingJobManager : ITrainingJobManager
{
    private readonly IWebHostEnvironment _env;
    private readonly IDatasetService _datasetService;
    private readonly IBlobStorageService _blobStorage;
    private readonly AppDbContext _context;
    private readonly ILogger<TrainingJobManager> _logger;

    public TrainingJobManager(
        IWebHostEnvironment env,
        IDatasetService datasetService,
        IBlobStorageService blobStorage,
        AppDbContext context,
        ILogger<TrainingJobManager> logger)
    {
        _env = env;
        _datasetService = datasetService;
        _blobStorage = blobStorage;
        _context = context;
        _logger = logger;
    }
    
    public class JobScope : IDisposable
    {
        public Guid JobId { get; }
        public string JobRootPath { get; }
        public string DataDir => Path.Combine(JobRootPath, "data");
        public string OutputDir => Path.Combine(JobRootPath, "output");
        public string BaseModelDir => Path.Combine(JobRootPath, "base_model");
        public string GoldenDir { get; } 
        public string OutputModelPath => Path.Combine(OutputDir, "model.safetensors");
        public string MetricsPath => Path.Combine(OutputDir, "metrics.json");

        private readonly ILogger _logger;

        public JobScope(Guid jobId, string rootPath, string goldenDir, ILogger logger)
        {
            JobId = jobId;
            JobRootPath = rootPath;
            GoldenDir = goldenDir;
            _logger = logger;
        }

        public void Dispose()
        {
            if (Directory.Exists(JobRootPath))
            {
                try 
                {
                    Directory.Delete(JobRootPath, true);
                    _logger.LogInformation("Cleaned up job directory: {Path}", JobRootPath);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("Failed to cleanup job directory {Path}: {Message}", JobRootPath, ex.Message);
                }
            }
        }
    }

    public JobScope CreateJobScope()
    {
        var jobId = Guid.NewGuid();
        var jobPath = Path.Combine(_env.ContentRootPath, "training_jobs", $"job_{jobId}");
        var goldenPath = Path.Combine(_env.ContentRootPath, "golden_set");

        if (!Directory.Exists(goldenPath))
        {
            _logger.LogCritical("Golden set directory not found at {Path}. ", goldenPath);
            throw new DirectoryNotFoundException($"Golden set not found at {goldenPath}.");
        }
        
        // Ensure directories exist
        Directory.CreateDirectory(Path.Combine(jobPath, "data"));
        Directory.CreateDirectory(Path.Combine(jobPath, "output"));
        Directory.CreateDirectory(Path.Combine(jobPath, "base_model"));

        return new JobScope(jobId, jobPath, goldenPath, _logger);
    }

    public async Task StageImagesAsync(JobScope scope, List<TrainingImage> newImages, List<TrainingImage> replayImages)
    {
        var allImages = newImages.Concat(replayImages);
        
        foreach (var img in allImages)
        {
            var destFolder = Path.Combine(scope.DataDir, img.Label.ToUpper());
            Directory.CreateDirectory(destFolder);
            
            string sourcePath = _datasetService.GetLocalFilePath(img.MediaImageId);
            var destPath = Path.Combine(destFolder, $"{img.Id}.jpg");
            
            if (File.Exists(sourcePath))
            {
                File.Copy(sourcePath, destPath, overwrite: true);
            }
            else
            {
                _logger.LogWarning("Expected local image {Id} not found at {Path}. Skipping.", img.Id, sourcePath);
            }
        }
        await Task.CompletedTask; 
    }

    public async Task<string> PrepareBaseModelAsync(JobScope scope)
    {
        string projectSeedDir = Path.Combine(_env.ContentRootPath, "seed_model");
        if (!Directory.Exists(projectSeedDir))
            throw new DirectoryNotFoundException($"Seed model directory missing at {projectSeedDir}");

        string[] configFiles = { "config.json", "preprocessor_config.json" };
        foreach (var file in configFiles)
        {
            string source = Path.Combine(projectSeedDir, file);
            string dest = Path.Combine(scope.BaseModelDir, file);
            if (File.Exists(source)) File.Copy(source, dest, overwrite: true);
            else throw new FileNotFoundException($"Missing config file: {file}");
        }
        
        var latestModel = await _context.ModelWeights
            .Where(m => m.IsDeployed)
            .OrderByDescending(m => m.CreatedAt)
            .FirstOrDefaultAsync();

        if (latestModel == null)
             throw new InvalidOperationException("Invariant violation: No deployed model found in DB.");

        if (string.IsNullOrEmpty(latestModel.MinioObjectPath))
             throw new InvalidOperationException($"Model {latestModel.Version} has no MinIO path.");
        
        string targetWeightsFile = Path.Combine(scope.BaseModelDir, "model.safetensors");
        _logger.LogInformation("Downloading weights {Version} from {Path}...", latestModel.Version, latestModel.MinioObjectPath);

        try
        {
            await _blobStorage.DownloadFileAsync(latestModel.MinioObjectPath, targetWeightsFile);
        }
        catch (Exception ex)
        {
            _logger.LogCritical(ex, "Failed to download base model {Version}. Aborting.", latestModel.Version);
            throw;
        }

        return scope.BaseModelDir;
    }
}