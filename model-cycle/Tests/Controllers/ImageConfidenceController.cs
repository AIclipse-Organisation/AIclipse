using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using ModelCycle.Controllers;
using ModelCycle.Domain;
using ModelCycle.Security;
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
        var authorizer = new Mock<IInternalRequestAuthorizer>();
        authorizer.Setup(a => a.RequireInternalRequest(It.IsAny<HttpRequest>())).Returns((IActionResult)null);
        _controller = new ImageConfidenceController(
            _mockWorkflow.Object,
            _mockLogger.Object,
            authorizer.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext(),
            },
        };
    }

    [Fact]
    public async Task Evaluate_ReturnsOk_WhenWorkflowSucceeds()
    {
        // Arrange
        var request = new EvaluateImageRequest{MediaImageId = "test"};
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
        var result = await _controller.Evaluate(new EvaluateImageRequest{MediaImageId = "test"});

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal("Media not found", badRequest.Value);
    }

    [Fact]
    public async Task Evaluate_RejectsMissingInternalToken()
    {
        var authorizer = new Mock<IInternalRequestAuthorizer>();
        authorizer.Setup(a => a.RequireInternalRequest(It.IsAny<HttpRequest>()))
            .Returns(new UnauthorizedObjectResult(new { detail = "Invalid internal auth token" }));
        var controller = new ImageConfidenceController(
            _mockWorkflow.Object,
            _mockLogger.Object,
            authorizer.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext(),
            },
        };

        var result = await controller.Evaluate(new EvaluateImageRequest { MediaImageId = "test" });

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Equal(401, unauthorized.StatusCode);
    }
}
