using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using ModelCycle.Controllers;
using ModelCycle.Domain;
using ModelCycle.Services.ImageConfidence;
using ModelCycle.Services.Training;
using Moq;
using Xunit;

namespace ModelCycle.Tests.Controllers;

public class ImageConfidenceControllerTests
{
    private readonly Mock<ITrainingWorkflowService> _mockWorkflow;
    private readonly Mock<ILogger<ImageConfidenceController>> _mockLogger;
    private readonly ImageConfidenceController _controller;

    public ImageConfidenceControllerTests()
    {
        _mockWorkflow = new Mock<ITrainingWorkflowService>();
        _mockLogger = new Mock<ILogger<ImageConfidenceController>>();
        _controller = new ImageConfidenceController(_mockWorkflow.Object, _mockLogger.Object);
    }

    [Fact]
    public async Task Evaluate_ReturnsOk_WhenWorkflowSucceeds()
    {
        // Arrange
        var request = new EvaluateImageRequest();
        var fakeResult = new ConfidenceResult { IsReadyForTraining = true, Probability = 0.95, TrainingLabel = "Fake" };

        _mockWorkflow.Setup(w => w.ProcessVoteAsync(request))
            .ReturnsAsync(fakeResult);

        // Act
        var result = await _controller.Evaluate(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(okResult.Value);
    }

    [Fact]
    public async Task Evaluate_ReturnsBadRequest_WhenWorkflowThrows()
    {
        // Arrange
        _mockWorkflow.Setup(w => w.ProcessVoteAsync(It.IsAny<EvaluateImageRequest>()))
            .ThrowsAsync(new Exception("Media not found"));

        // Act
        var result = await _controller.Evaluate(new EvaluateImageRequest());

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("Media not found", badRequest.Value);
    }
}