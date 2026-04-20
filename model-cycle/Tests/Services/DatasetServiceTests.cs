using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using ModelCycle.Services;
using ModelCycle.Services.Data;
using Moq;
using Xunit;

namespace Tests.Services;

public sealed class DatasetServiceTests
{
    [Fact]
    public async Task SaveImageAsync_DownloadsThroughBlobStorageInterface()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"dataset-service-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempRoot);

        try
        {
            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string>
                {
                    ["TRAINING_DATA_PATH"] = tempRoot,
                })
                .Build();

            var blobStorage = new Mock<IBlobStorageService>();
            blobStorage
                .Setup(service => service.DownloadFileAsync("images/img_1.png", It.IsAny<string>(), "images"))
                .Returns(Task.CompletedTask);

            var datasetService = new DatasetService(blobStorage.Object, config);

            await datasetService.SaveImageAsync("img_1", "images/img_1.png");

            blobStorage.Verify(
                service => service.DownloadFileAsync(
                    "images/img_1.png",
                    Path.Combine(tempRoot, "images", "img_1.png"),
                    "images"
                ),
                Times.Once
            );
        }
        finally
        {
            if (Directory.Exists(tempRoot))
            {
                Directory.Delete(tempRoot, recursive: true);
            }
        }
    }
}
