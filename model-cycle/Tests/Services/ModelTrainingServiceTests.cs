using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
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
    private readonly Mock<IBlobStorageService> _mockBlobStorage; // Interface Mock
    private readonly Mock<ILogger<ModelTrainingService>> _mockLogger;
    private readonly ModelTrainingService _service;

    public ModelTrainingServiceTests()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        _db = new AppDbContext(options);

        // Simple Interface Mocks
        _mockJobManager = new Mock<ITrainingJobManager>();
        _mockPythonExecutor = new Mock<IPythonExecutor>();
        _mockBlobStorage = new Mock<IBlobStorageService>(); // No config needed!
        _mockLogger = new Mock<ILogger<ModelTrainingService>>();

        // Setup Upload Success Default
        _mockBlobStorage
            .Setup(b => b.UploadFileAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync((Stream s, string path, string f, string c) => path); // Return the path as success

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
            Id = Guid.NewGuid(), Status = TrainingStatus.Ready, Label = "Real", MediaImageId="x", S3Key="x" 
        });
        await _db.SaveChangesAsync();

        var result = await _service.RunTrainingCycleAsync();

        Assert.Null(result);
        _mockJobManager.Verify(x => x.CreateJobScope(), Times.Never);
    }

    [Fact]
    public async Task RunTrainingCycleAsync_SufficientData_DeploysModel_WhenMetricsImprove()
    {
        // Arrange 
        for (int i = 0; i < 50; i++) 
        {
            _db.TrainingImages.Add(new TrainingImage { Id = Guid.NewGuid(), Status = TrainingStatus.Ready, Label = "Real", MediaImageId=$"r{i}", S3Key="k" });
            _db.TrainingImages.Add(new TrainingImage { Id = Guid.NewGuid(), Status = TrainingStatus.Ready, Label = "Fake", MediaImageId=$"f{i}", S3Key="k" });
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
            Validation = new Metrics { Accuracy = 0.95 },
            GoldenTest = new Metrics { Accuracy = 0.99 }
        };
        await File.WriteAllTextAsync(mockScope.MetricsPath, JsonSerializer.Serialize(metrics));
        await File.WriteAllTextAsync(mockScope.OutputModelPath, "fake_model_content");

        // Act
        var resultId = await _service.RunTrainingCycleAsync();

        // Assert
        Assert.NotNull(resultId);
        var model = await _db.ModelWeights.FindAsync(resultId);
        Assert.True(model.IsDeployed);

        mockScope.Dispose();
    }
}