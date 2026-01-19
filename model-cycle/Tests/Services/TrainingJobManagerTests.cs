using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration; 
using Microsoft.Extensions.Logging;
using ModelCycle.Data;
using ModelCycle.DTOs;
using ModelCycle.DTOs.ModelTraining;
using ModelCycle.Models;
using ModelCycle.Services;
using ModelCycle.Services.Data;
using ModelCycle.Services.Training;
using Moq;
using Xunit;

namespace Tests.Services;


public class ModelTrainingServiceTests
{
    private readonly AppDbContext _db;
    private readonly Mock<TrainingJobManager> _mockJobManager;
    private readonly Mock<PythonExecutor> _mockPythonExecutor;
    private readonly Mock<BlobStorageService> _mockBlobStorage;
    private readonly Mock<ILogger<ModelTrainingService>> _mockLogger;
    private readonly ModelTrainingService _service;

    public ModelTrainingServiceTests()
    {
        // 1. InMemory Database
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        _db = new AppDbContext(options);

        // 2. Setup Configuration Mock (Required for BlobStorageService constructor)
        var mockConfig = new Mock<IConfiguration>();
        mockConfig.Setup(c => c["MINIO_BUCKET_NAME"]).Returns("test-bucket");
        mockConfig.Setup(c => c["S3_ENDPOINT"]).Returns("localhost");
        mockConfig.Setup(c => c["AWS_ACCESS_KEY_ID"]).Returns("test");
        mockConfig.Setup(c => c["AWS_SECRET_ACCESS_KEY"]).Returns("test");

        // 3. Initialize BlobStorage Mock FIRST
        // We must pass constructor arguments because it's a class, not an interface.
        _mockBlobStorage = new Mock<BlobStorageService>(
            mockConfig.Object, 
            Mock.Of<ILogger<BlobStorageService>>()
        );

        // 4. Initialize JobManager Mock using the Blob Mock
        // Note: TrainingJobManager methods must be 'virtual' for this to work
        _mockJobManager = new Mock<TrainingJobManager>(
            Mock.Of<IWebHostEnvironment>(), 
            Mock.Of<IDatasetService>(), 
            _mockBlobStorage.Object, // <--- Use the Object, not Mock.Of<T>()
            _db, 
            Mock.Of<ILogger<TrainingJobManager>>());

        _mockPythonExecutor = new Mock<PythonExecutor>(Mock.Of<ILogger<PythonExecutor>>());
        _mockLogger = new Mock<ILogger<ModelTrainingService>>();

        _service = new ModelTrainingService(
            _db, 
            _mockJobManager.Object, 
            _mockPythonExecutor.Object, 
            _mockBlobStorage.Object, 
            _mockLogger.Object
        );
    }

    [Fact]
    public async Task RunTrainingCycleAsync_InsufficientData_ReturnsNull()
    {
        _db.TrainingImages.Add(new TrainingImage { Status = TrainingStatus.Ready, Label = "Real" });
        await _db.SaveChangesAsync();

        var result = await _service.RunTrainingCycleAsync();

        Assert.Null(result);
        _mockPythonExecutor.Verify(x => x.RunTrainingAsync(It.IsAny<TrainingJobManager.JobScope>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task RunTrainingCycleAsync_SufficientData_DeploysModel_WhenMetricsImprove()
    {
        for (int i = 0; i < 50; i++) _db.TrainingImages.Add(new TrainingImage { Status = TrainingStatus.Ready, Label = "Real" });
        for (int i = 0; i < 50; i++) _db.TrainingImages.Add(new TrainingImage { Status = TrainingStatus.Ready, Label = "Fake" });
        await _db.SaveChangesAsync();

        var jobId = Guid.NewGuid();
        var tempPath = Path.Combine(Path.GetTempPath(), "test_job_" + jobId);
        Directory.CreateDirectory(Path.Combine(tempPath, "output"));

        var mockScope = new TrainingJobManager.JobScope(jobId, tempPath, "golden", Mock.Of<ILogger>());
        
        // Mocking 'virtual' methods
        _mockJobManager.Setup(x => x.CreateJobScope()).Returns(mockScope);
        _mockJobManager.Setup(x => x.PrepareBaseModelAsync(mockScope)).ReturnsAsync("base_model_path");
        _mockPythonExecutor.Setup(x => x.RunTrainingAsync(mockScope, "base_model_path")).ReturnsAsync(true);
        
        var metrics = new PythonTrainingResult
        {
            Validation = new Metrics { Accuracy = 0.95 },
            GoldenTest = new Metrics { Accuracy = 0.99 }
        };
        await File.WriteAllTextAsync(mockScope.MetricsPath, JsonSerializer.Serialize(metrics));
        await File.WriteAllTextAsync(mockScope.OutputModelPath, "fake_model_content");

        var resultId = await _service.RunTrainingCycleAsync();

        Assert.NotNull(resultId);
        var modelInDb = await _db.ModelWeights.FindAsync(resultId);
        Assert.NotNull(modelInDb);
        Assert.True(modelInDb.IsDeployed);

        mockScope.Dispose();
    }

    [Fact]
    public async Task RunTrainingCycleAsync_RejectsModel_WhenGoldenAccuracyDrops()
    {
        _db.ModelWeights.Add(new ModelWeights { IsDeployed = true, GoldenTestAccuracy = 0.95 });
        
        for (int i = 0; i < 50; i++) _db.TrainingImages.Add(new TrainingImage { Status = TrainingStatus.Ready, Label = "Real" });
        for (int i = 0; i < 50; i++) _db.TrainingImages.Add(new TrainingImage { Status = TrainingStatus.Ready, Label = "Fake" });
        await _db.SaveChangesAsync();

        var jobId = Guid.NewGuid();
        var tempPath = Path.Combine(Path.GetTempPath(), "test_job_" + jobId);
        Directory.CreateDirectory(Path.Combine(tempPath, "output"));
        var mockScope = new TrainingJobManager.JobScope(jobId, tempPath, "golden", Mock.Of<ILogger>());

        _mockJobManager.Setup(x => x.CreateJobScope()).Returns(mockScope);
        _mockJobManager.Setup(x => x.PrepareBaseModelAsync(mockScope)).ReturnsAsync("base_path");
        _mockPythonExecutor.Setup(x => x.RunTrainingAsync(mockScope, "base_path")).ReturnsAsync(true);

        var metrics = new PythonTrainingResult
        {
            Validation = new Metrics { Accuracy = 0.90 },
            GoldenTest = new Metrics { Accuracy = 0.80 } 
        };
        await File.WriteAllTextAsync(mockScope.MetricsPath, JsonSerializer.Serialize(metrics));
        await File.WriteAllTextAsync(mockScope.OutputModelPath, "fake_model_content");

        var resultId = await _service.RunTrainingCycleAsync();

        var modelInDb = await _db.ModelWeights.FindAsync(resultId);
        Assert.False(modelInDb.IsDeployed);
        Assert.NotNull(modelInDb.RejectionReason);

        mockScope.Dispose();
    }
}