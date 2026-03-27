using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using ModelCycle.Data;
using ModelCycle.DTOs;
using ModelCycle.DTOs.ModelTraining;
using ModelCycle.Models;
using ModelCycle.Services;
using ModelCycle.Services.Training;
using Moq;
using Xunit;

public class ModelTrainingServiceTests
{
    private readonly AppDbContext _db;
    private readonly Mock<ITrainingJobManager> _mockJobManager;
    private readonly Mock<IPythonExecutor> _mockPythonExecutor;
    private readonly Mock<IBlobStorageService> _mockBlobStorage;
    private readonly Mock<ILogger<ModelTrainingService>> _mockLogger;
    
    private readonly ModelTrainingService _service;

    public ModelTrainingServiceTests()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        _db = new AppDbContext(options);
        
        _mockJobManager = new Mock<ITrainingJobManager>();
        _mockPythonExecutor = new Mock<IPythonExecutor>();
        _mockBlobStorage = new Mock<IBlobStorageService>();
        _mockLogger = new Mock<ILogger<ModelTrainingService>>();
        
        _mockBlobStorage
            .Setup(x => x.UploadFileAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync("s3/path/to/model");

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
        _db.TrainingImages.Add(new TrainingImage 
        { 
            Id = Guid.NewGuid(),
            Status = TrainingStatus.Ready, 
            Label = "Real", 
            MediaImageId = "test_unique_1", // Unique ID
            S3Key = "test-bucket" 
        });
        await _db.SaveChangesAsync();

        var result = await _service.RunTrainingCycleAsync();

        Assert.Null(result);
        
        _mockPythonExecutor.Verify(x => x.RunTrainingAsync(It.IsAny<TrainingJobManager.JobScope>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task RunTrainingCycleAsync_SufficientData_DeploysModel_WhenMetricsImprove()
    {
        for (int i = 0; i < 50; i++) 
        {
            _db.TrainingImages.Add(new TrainingImage { 
                Status = TrainingStatus.Ready, 
                Label = "Real", 
                MediaImageId = $"real_{i}", // Unique
                S3Key = "test-bucket" 
            });
        }
        for (int i = 0; i < 50; i++) 
        {
            _db.TrainingImages.Add(new TrainingImage { 
                Status = TrainingStatus.Ready, 
                Label = "Fake", 
                MediaImageId = $"fake_{i}", // Unique
                S3Key = "test-bucket" 
            });
        }
        await _db.SaveChangesAsync();

        var jobId = Guid.NewGuid();
        var tempPath = Path.Combine(Path.GetTempPath(), "test_job_" + jobId);
        Directory.CreateDirectory(Path.Combine(tempPath, "output"));

        var mockScope = new TrainingJobManager.JobScope(jobId, tempPath, "golden", Mock.Of<ILogger>());
        
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
        
        for (int i = 0; i < 50; i++) 
        {
             _db.TrainingImages.Add(new TrainingImage { Status = TrainingStatus.Ready, Label = "Real", MediaImageId = $"real_r_{i}", S3Key = "test" });
        }
        for (int i = 0; i < 50; i++) 
        {
             _db.TrainingImages.Add(new TrainingImage { Status = TrainingStatus.Ready, Label = "Fake", MediaImageId = $"fake_r_{i}", S3Key = "test" });
        }
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