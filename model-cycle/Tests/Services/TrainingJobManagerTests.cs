using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ModelCycle.Data;
using ModelCycle.Models;
using ModelCycle.Services; 
using ModelCycle.Services.Training;
using Moq;
using Xunit;

namespace ModelCycle.Tests.Services;

public class TrainingJobManagerTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly Mock<IWebHostEnvironment> _mockEnv;
    private readonly Mock<IDatasetService> _mockDatasetService;
    private readonly Mock<IBlobStorageService> _mockBlobStorage; 
    private readonly Mock<ILogger<TrainingJobManager>> _mockLogger;
    private readonly TrainingJobManager _manager;
    private readonly string _testRootPath;

    public TrainingJobManagerTests()
    {
        _testRootPath = Path.Combine(Path.GetTempPath(), "ModelCycleTests_" + Guid.NewGuid());
        Directory.CreateDirectory(_testRootPath);
        
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        _db = new AppDbContext(options);
        
        _mockEnv = new Mock<IWebHostEnvironment>();
        _mockEnv.Setup(e => e.ContentRootPath).Returns(_testRootPath);
        
        _mockDatasetService = new Mock<IDatasetService>();
        _mockBlobStorage = new Mock<IBlobStorageService>();
        _mockLogger = new Mock<ILogger<TrainingJobManager>>();
        
        _manager = new TrainingJobManager(
            _mockEnv.Object,
            _mockDatasetService.Object,
            _mockBlobStorage.Object,
            _db,
            _mockLogger.Object
        );
    }

    public void Dispose()
    {
        if (Directory.Exists(_testRootPath))
            Directory.Delete(_testRootPath, true);
        
        _db.Dispose();
    }

    [Fact]
    public void CreateJobScope_Throws_WhenGoldenSetMissing()
    {
        Assert.Throws<DirectoryNotFoundException>(() => _manager.CreateJobScope());
    }

    [Fact]
    public void CreateJobScope_CreatesDirectories_WhenGoldenSetExists()
    {
        // Arrange
        var goldenPath = Path.Combine(_testRootPath, "golden_set");
        Directory.CreateDirectory(goldenPath);

        // Act
        using var scope = _manager.CreateJobScope();

        // Assert
        Assert.True(Directory.Exists(scope.DataDir), "Data directory not created");
        Assert.True(Directory.Exists(scope.OutputDir), "Output directory not created");
        Assert.True(Directory.Exists(scope.BaseModelDir), "Base Model directory not created");
        Assert.Equal(goldenPath, scope.GoldenDir);
    }

    [Fact]
    public async Task StageImagesAsync_CopiesFiles_Correctly()
    {
        // Arrange
        var goldenPath = Path.Combine(_testRootPath, "golden_set");
        Directory.CreateDirectory(goldenPath);
        
        var sourceImagePath = Path.Combine(_testRootPath, "source_image.jpg");
        await File.WriteAllTextAsync(sourceImagePath, "dummy image content");

        var image = new TrainingImage
        {
            Id = Guid.NewGuid(),
            MediaImageId = "img_1",
            S3Key = "img_1.jpg",
            Label = "Real",
            Status = TrainingStatus.Ready
        };

        _mockDatasetService
            .Setup(ds => ds.GetLocalFilePath("img_1"))
            .Returns(sourceImagePath);

        using var scope = _manager.CreateJobScope();

        // Act
        await _manager.StageImagesAsync(scope, new List<TrainingImage> { image }, new List<TrainingImage>());

        // Assert
        var expectedDestPath = Path.Combine(scope.DataDir, "REAL", $"{image.Id}.jpg");
        Assert.True(File.Exists(expectedDestPath), "Image was not copied to the job directory");
    }

    [Fact]
    public async Task PrepareBaseModelAsync_DownloadsModel_AndCopiesConfig()
    {
        // Arrange
        var goldenPath = Path.Combine(_testRootPath, "golden_set");
        Directory.CreateDirectory(goldenPath);
        using var scope = _manager.CreateJobScope();
        
        var seedDir = Path.Combine(_testRootPath, "seed_model");
        Directory.CreateDirectory(seedDir);
        await File.WriteAllTextAsync(Path.Combine(seedDir, "config.json"), "{}");
        await File.WriteAllTextAsync(Path.Combine(seedDir, "preprocessor_config.json"), "{}");
        
        _db.ModelWeights.Add(new ModelWeights
        {
            Version = "v1",
            IsDeployed = true,
            MinioObjectPath = "models/v1/model.safetensors",
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        
        _mockBlobStorage
            .Setup(b => b.DownloadFileAsync("models/v1/model.safetensors", It.IsAny<string>(), null))
            .Returns(Task.CompletedTask);

        // Act
        var resultPath = await _manager.PrepareBaseModelAsync(scope);

        // Assert
        Assert.Equal(scope.BaseModelDir, resultPath);
        
        Assert.True(File.Exists(Path.Combine(scope.BaseModelDir, "config.json")));
        
        _mockBlobStorage.Verify(b => b.DownloadFileAsync("models/v1/model.safetensors", It.IsAny<string>(), null), Times.Once);
    }
}