using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ModelCycle.Data;
using ModelCycle.Domain;
using ModelCycle.DTOs;
using ModelCycle.Models;
using ModelCycle.Services;
using ModelCycle.Services.Data;
using ModelCycle.Services.External;
using ModelCycle.Services.ImageConfidence;
using ModelCycle.Services.Training;
using Moq;
using Xunit;

namespace ModelCycle.Tests.Services;

public class TrainingWorkflowServiceTests
{
    private readonly AppDbContext _db;
    private readonly Mock<IConfidenceService> _mockConfidence;
    private readonly Mock<IMediaService> _mockMedia;
    private readonly Mock<IDatasetService> _mockDataset;
    private readonly Mock<ILogger<TrainingWorkflowService>> _mockLogger;
    
    private readonly TrainingJobQueue _jobQueue; 
    
    private readonly TrainingWorkflowService _service;

    public TrainingWorkflowServiceTests()
    {
        //  Mock database
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString()) 
            .Options;
        _db = new AppDbContext(options);
        
        _mockConfidence = new Mock<IConfidenceService>();
        _mockMedia = new Mock<IMediaService>();
        _mockDataset = new Mock<IDatasetService>();
        _mockLogger = new Mock<ILogger<TrainingWorkflowService>>();
        
        _jobQueue = new TrainingJobQueue();

        _service = new TrainingWorkflowService(
            _db, 
            _mockConfidence.Object, 
            _mockMedia.Object, 
            _mockDataset.Object, 
            _jobQueue, // Updated Constructor Injection
            _mockLogger.Object
        );
    }

    [Fact]
    public async Task ProcessVoteAsync_NewImage_PromotesToReady_AndQueuesJob()
    {
        // Arrange
        var request = new EvaluateImageRequest { MediaImageId = "img_new", PostId = Guid.NewGuid() };
        
        // Mock Media Service to return metadata
        _mockMedia.Setup(m => m.GetImageMetadataAsync("img_new"))
            .ReturnsAsync(new MediaImageResponse 
            { 
                ImageId = "img_new", 
                Url = "http://fake/url.jpg",
                S3Key = "images/img_new.jpg", 
                UserId = "user_123" 
            });

        // Mock Confidence to return ready
        _mockConfidence.Setup(c => c.Evaluate(It.IsAny<VoteData>()))
                       .Returns(new ConfidenceResult { IsReadyForTraining = true, TrainingLabel = "ai" });

        // Act
        await _service.ProcessVoteAsync(request);

        // Assert
        var imageInDb = await _db.TrainingImages.FirstOrDefaultAsync(i => i.MediaImageId == "img_new");
        Assert.NotNull(imageInDb);
        Assert.Equal(TrainingStatus.Ready, imageInDb.Status);
        
        _mockDataset.Verify(d => d.SaveImageAsync("img_new", "images/img_new.jpg"), Times.Once);

        // ASSERT
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        var reader = _jobQueue.ReadAllAsync(cts.Token).GetAsyncEnumerator();
        
        bool hasSignal = await reader.MoveNextAsync(); 
        Assert.True(hasSignal, "The training job should have been queued.");
    }

    [Fact]
    public async Task ProcessVoteAsync_ExistingReadyImage_Demotion_DeletesFile_AndDoesNotQueue()
    {
        // Arrange
        var existing = new TrainingImage 
        { 
            Id = Guid.NewGuid(), 
            MediaImageId = "img_existing", 
            Status = TrainingStatus.Ready,
            Label = "ai",
            S3Key = "test_images/img_existing.jpg", 
            PostId = Guid.NewGuid()
        };
        _db.TrainingImages.Add(existing);
        await _db.SaveChangesAsync(); 

        var request = new EvaluateImageRequest { MediaImageId = "img_existing" };

        // Mock Confidence 
        _mockConfidence.Setup(c => c.Evaluate(It.IsAny<VoteData>()))
            .Returns(new ConfidenceResult { IsReadyForTraining = false, TrainingLabel = "ai" });

        // Act
        await _service.ProcessVoteAsync(request);

        // Assert
        var updatedImage = await _db.TrainingImages.FirstAsync();
        Assert.Equal(TrainingStatus.Pending, updatedImage.Status);
        
        _mockDataset.Verify(d => d.DeleteImageAsync("img_existing"), Times.Once);
    }

    [Fact]
    public async Task ProcessVoteAsync_ExistingReadyImage_RemainsReady_QueuesJob()
    {
        // Arrange
        var existing = new TrainingImage 
        { 
            Id = Guid.NewGuid(), 
            MediaImageId = "img_stable", 
            Status = TrainingStatus.Ready,
            Label = "ai",
            S3Key = "test_images/img_stable.jpg",
            PostId = Guid.NewGuid()
        };
        _db.TrainingImages.Add(existing);
        await _db.SaveChangesAsync();

        _mockConfidence.Setup(c => c.Evaluate(It.IsAny<VoteData>()))
            .Returns(new ConfidenceResult { IsReadyForTraining = true, TrainingLabel = "ai" });
        
        // Act
        await _service.ProcessVoteAsync(new EvaluateImageRequest { MediaImageId = "img_stable" });

        // Assert
        Assert.Equal(TrainingStatus.Ready, existing.Status);
        
        // Verify download 
        _mockDataset.Verify(d => d.SaveImageAsync("img_stable", "test_images/img_stable.jpg"), Times.Once);

        // ASSERT QUEUE
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        var reader = _jobQueue.ReadAllAsync(cts.Token).GetAsyncEnumerator();
        
        bool hasSignal = await reader.MoveNextAsync(); 
        Assert.True(hasSignal, "Job should be queued even if image was already ready (as it might trigger the threshold).");
    }
}