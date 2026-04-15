using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using ModelCycle.DTOs;
using ModelCycle.Services.External;
using Moq;
using Moq.Protected;
using Xunit;

namespace Tests.Services;

public class MediaServiceTests
{
    private readonly Mock<HttpMessageHandler> _handlerMock;
    private readonly Mock<ILogger<MediaService>> _loggerMock;
    private readonly MediaService _service;

    public MediaServiceTests()
    {
        _handlerMock = new Mock<HttpMessageHandler>();
        _loggerMock = new Mock<ILogger<MediaService>>();
        
        var httpClient = new HttpClient(_handlerMock.Object)
        {
            BaseAddress = new Uri("http://localhost")
        };
        
        _service = new MediaService(httpClient, _loggerMock.Object);
    }

    [Fact]
    public async Task GetImageMetadataAsync_ReturnsObject_WhenResponseIs200()
    {
        // Arrange
        var fakeResponse = new MediaImageResponse
        {
            ImageId = "img_123",
            Url = "http://s3/img.jpg",
            UserId = "user_test_123",
            S3Key = "images/img_123.jpg",
            Verdict = "pending",
            Label = "unknown",
            Confidence = 1,
            IsPublic = true,
            ModelVersion = "v1.0.0"
        };
        var json = JsonSerializer.Serialize(fakeResponse);

        _handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>()
            )
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(json)
            });

        // Act
        var result = await _service.GetImageMetadataAsync("img_123");

        // Assert
        Assert.NotNull(result);
        Assert.Equal("img_123", result.ImageId);
        Assert.Equal("user_test_123", result.UserId); // Optional: verify new fields
    }

    [Fact]
    public async Task GetImageMetadataAsync_ReturnsNull_WhenResponseIs404()
    {
        // Arrange
        _handlerMock.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>()
            )
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.NotFound
            });

        // Act
        var result = await _service.GetImageMetadataAsync("missing_img");

        // Assert
        Assert.Null(result);
    }
}