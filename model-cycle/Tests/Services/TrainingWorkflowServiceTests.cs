using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ModelCycle.Data;
using ModelCycle.Domain;
using ModelCycle.Models;
using ModelCycle.Repositories;
using ModelCycle.Services;
using ModelCycle.Services.ImageConfidence;
using ModelCycle.Services.Training;
using Moq;
using Xunit;

namespace ModelCycle.Tests.Services;

public class TrainingWorkflowServiceTests
{
    private readonly AppDbContext _db;
    private readonly Mock<IConfidenceService> _mockConfidence;
    private readonly Mock<IDatasetService> _mockDataset;
    private readonly Mock<ILogger<TrainingWorkflowService>> _mockLogger;
    private readonly Mock<IModelWeightsRepository> _mockModelRepo;
    private readonly Mock<IAuthService> _mockAuthService;

    private readonly TrainingJobQueue _jobQueue;

    private readonly TrainingWorkflowService _service;

    public TrainingWorkflowServiceTests()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        _db = new AppDbContext(options);

        _mockConfidence = new Mock<IConfidenceService>();
        _mockDataset = new Mock<IDatasetService>();
        _mockLogger = new Mock<ILogger<TrainingWorkflowService>>();
        _mockModelRepo = new Mock<IModelWeightsRepository>();
        _mockAuthService = new Mock<IAuthService>();

        // Return empty accuracy list by default so the service's ToDictionary
        // call doesn't NRE when the request carries no votes.
        _mockAuthService.Setup(a => a.GetUsersAccuracyAsync(It.IsAny<List<string>>()))
            .ReturnsAsync(new List<UserAccuracy>());

        _jobQueue = new TrainingJobQueue();

        _service = new TrainingWorkflowService(
            _db,
            _mockConfidence.Object,
            _mockDataset.Object,
            _jobQueue,
            _mockLogger.Object,
            _mockModelRepo.Object,
            _mockAuthService.Object
        );
    }

    [Fact]
    public async Task ProcessVoteAsync_NewImage_PromotesToReady_AndQueuesJob()
    {
        var request = new EvaluateImageRequest
        {
            MediaImageId = "img_new",
            PostId = Guid.NewGuid().ToString(),
            S3Key = "images/img_new.jpg",
            ModelVersion = "v1.0.0",
            Label = "real",
        };

        _mockConfidence.Setup(c => c.Evaluate(It.IsAny<WeightedVoteData>(), It.IsAny<ModelWeights>()))
                       .Returns(new ConfidenceResult { IsReadyForTraining = true, TrainingLabel = "ai" });

        await _service.ProcessVoteAsync(request);

        var imageInDb = await _db.TrainingImages.FirstOrDefaultAsync(i => i.MediaImageId == "img_new");
        Assert.NotNull(imageInDb);
        Assert.Equal(TrainingStatus.Ready, imageInDb.Status);

        _mockDataset.Verify(d => d.SaveImageAsync("img_new", "images/img_new.jpg"), Times.Once);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        var reader = _jobQueue.ReadAllAsync(cts.Token).GetAsyncEnumerator();

        bool hasSignal = await reader.MoveNextAsync();
        Assert.True(hasSignal, "The training job should have been queued.");
    }

    [Fact]
    public async Task ProcessVoteAsync_ExistingReadyImage_Demotion_DeletesFile_AndDoesNotQueue()
    {
        var existing = new TrainingImage
        {
            Id = Guid.NewGuid(),
            MediaImageId = "img_existing",
            Status = TrainingStatus.Ready,
            Label = "ai",
            S3Key = "test_images/img_existing.jpg",
            PostId = Guid.NewGuid().ToString()
        };
        _db.TrainingImages.Add(existing);
        await _db.SaveChangesAsync();

        var request = new EvaluateImageRequest
        {
            MediaImageId = "img_existing",
            S3Key = "test_images/img_existing.jpg",
            ModelVersion = "v1.0.0",
        };

        _mockConfidence.Setup(c => c.Evaluate(It.IsAny<WeightedVoteData>(), It.IsAny<ModelWeights>()))
            .Returns(new ConfidenceResult { IsReadyForTraining = false, TrainingLabel = "ai" });

        await _service.ProcessVoteAsync(request);

        var updatedImage = await _db.TrainingImages.FirstAsync();
        Assert.Equal(TrainingStatus.Pending, updatedImage.Status);

        _mockDataset.Verify(d => d.DeleteImageAsync("img_existing"), Times.Once);
    }

    [Fact]
    public async Task ProcessVoteAsync_ExistingReadyImage_RemainsReady_DoesNotQueue()
    {
        var existing = new TrainingImage
        {
            Id = Guid.NewGuid(),
            MediaImageId = "img_stable",
            Status = TrainingStatus.Ready,
            Label = "ai",
            S3Key = "test_images/img_stable.jpg",
            PostId = Guid.NewGuid().ToString()
        };
        _db.TrainingImages.Add(existing);
        await _db.SaveChangesAsync();

        _mockConfidence.Setup(c => c.Evaluate(It.IsAny<WeightedVoteData>(), It.IsAny<ModelWeights>()))
            .Returns(new ConfidenceResult { IsReadyForTraining = true, TrainingLabel = "ai" });

        var request = new EvaluateImageRequest
        {
            MediaImageId = "img_stable",
            S3Key = "test_images/img_stable.jpg",
            ModelVersion = "v1.0.0",
        };

        await _service.ProcessVoteAsync(request);

        Assert.Equal(TrainingStatus.Ready, existing.Status);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var reader = _jobQueue.ReadAllAsync(cts.Token).GetAsyncEnumerator();

        await Assert.ThrowsAsync<OperationCanceledException>(async () =>
        {
            await reader.MoveNextAsync();
        });
    }

    [Fact]
    public async Task ProcessVoteAsync_NewImage_RequiresCanonicalMetadataInRequest()
    {
        var request = new EvaluateImageRequest
        {
            MediaImageId = "img_missing_meta",
            PostId = Guid.NewGuid().ToString(),
        };

        var error = await Assert.ThrowsAsync<Exception>(() => _service.ProcessVoteAsync(request));

        Assert.Equal("Training image metadata missing", error.Message);
    }
}
