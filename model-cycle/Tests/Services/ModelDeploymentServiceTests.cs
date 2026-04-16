using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using ModelCycle.Data;
using ModelCycle.DTOs;
using ModelCycle.Models;
using ModelCycle.Services;
using Moq;
using Xunit;

namespace Tests.Services;

public class ModelDeploymentServiceTests
{
    private static AppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static ModelDeploymentService CreateService(
        AppDbContext db,
        Mock<IBlobStorageService> blobStorage,
        Mock<IDetectorClientService> detectorClient)
    {
        var dataProtectionProvider = new EphemeralDataProtectionProvider();
        var memoryCache = new MemoryCache(new MemoryCacheOptions());
        return new ModelDeploymentService(
            db,
            blobStorage.Object,
            detectorClient.Object,
            memoryCache,
            dataProtectionProvider,
            NullLogger<ModelDeploymentService>.Instance
        );
    }

    [Fact]
    public async Task CreateAndFinalizeUpload_DeploysStoredModelAndDeactivatesPreviousVersion()
    {
        await using var db = CreateDbContext();
        db.ModelWeights.Add(new ModelWeights
        {
            Id = Guid.NewGuid(),
            Version = "v1.0.0",
            MinioObjectPath = "models/v1.0.0.pt",
            IsDeployed = true,
            CreatedAt = DateTime.UtcNow.AddDays(-1),
        });
        await db.SaveChangesAsync();

        var blobStorage = new Mock<IBlobStorageService>();
        blobStorage
            .Setup(b => b.CreatePresignedUploadUrlAsync(It.IsAny<string>(), It.IsAny<int>()))
            .ReturnsAsync("https://storage.test/model-cycle-storage/models/uploads/abc/v2.0.1.pt");
        blobStorage
            .Setup(b => b.StatObjectAsync(It.IsAny<string>(), null))
            .ReturnsAsync((string objectName, string _) =>
            {
                if (objectName == "models/v2.0.1.pt")
                {
                    return null;
                }

                return new BlobObjectInfo(objectName, 123);
            });
        blobStorage
            .Setup(b => b.CopyObjectAsync(It.IsAny<string>(), It.IsAny<string>(), null))
            .Returns(Task.CompletedTask);
        blobStorage
            .Setup(b => b.DeleteObjectsOlderThanAsync("models/uploads/", It.IsAny<DateTime>(), null))
            .ReturnsAsync(0);
        blobStorage
            .Setup(b => b.DeleteFileAsync(It.IsAny<string>(), null))
            .Returns(Task.CompletedTask);

        var detectorClient = new Mock<IDetectorClientService>();
        detectorClient
            .Setup(d => d.NotifyModelUpdateAsync(It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync(true);

        var service = CreateService(db, blobStorage, detectorClient);

        var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
        {
            Version = "2.0.1",
            FileName = "weights.pt",
            FileSize = 123,
            ContentType = "application/octet-stream",
        });

        var deployed = await service.FinalizeUploadedModelAsync(new FinalizeModelUploadRequest
        {
            UploadId = session.UploadId,
            Version = "2.0.1",
            NewImagesCount = 1,
        });

        Assert.Equal("v2.0.1", deployed.Version);
        Assert.True(deployed.IsDeployed);
        Assert.Equal("models/v2.0.1.pt", deployed.MinioObjectPath);
        Assert.Equal(2, await db.ModelWeights.CountAsync());
        Assert.Equal(1, await db.ModelWeights.CountAsync(m => m.IsDeployed));
        Assert.False((await db.ModelWeights.SingleAsync(m => m.Version == "v1.0.0")).IsDeployed);
        blobStorage.Verify(
            b => b.CopyObjectAsync(
                It.Is<string>(path => path.StartsWith("models/uploads/", StringComparison.Ordinal)),
                "models/v2.0.1.pt",
                null
            ),
            Times.Once
        );
        blobStorage.Verify(
            b => b.DeleteFileAsync(
                It.Is<string>(path => path.StartsWith("models/uploads/", StringComparison.Ordinal)),
                null
            ),
            Times.Once
        );

        detectorClient.Verify(
            d => d.NotifyModelUpdateAsync(
                "v2.0.1",
                "models/v2.0.1.pt"
            ),
            Times.Once
        );
    }

    [Fact]
    public async Task FinalizeUpload_RejectsSizeMismatch()
    {
        await using var db = CreateDbContext();

        var blobStorage = new Mock<IBlobStorageService>();
        blobStorage
            .Setup(b => b.CreatePresignedUploadUrlAsync(It.IsAny<string>(), It.IsAny<int>()))
            .ReturnsAsync("https://storage.test/model-cycle-storage/models/uploads/abc/v2.0.1.pt");
        blobStorage
            .Setup(b => b.DeleteObjectsOlderThanAsync("models/uploads/", It.IsAny<DateTime>(), null))
            .ReturnsAsync(0);
        blobStorage
            .Setup(b => b.StatObjectAsync(It.IsAny<string>(), null))
            .ReturnsAsync((string objectName, string _) =>
            {
                if (objectName == "models/v2.0.1.pt")
                {
                    return null;
                }

                return new BlobObjectInfo(objectName, 99);
            });

        var detectorClient = new Mock<IDetectorClientService>();
        var service = CreateService(db, blobStorage, detectorClient);

        var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
        {
            Version = "v2.0.1",
            FileName = "weights.pt",
            FileSize = 123,
            ContentType = "application/octet-stream",
        });

        var ex = await Assert.ThrowsAsync<ModelUploadException>(() => service.FinalizeUploadedModelAsync(new FinalizeModelUploadRequest
        {
            UploadId = session.UploadId,
            Version = "v2.0.1",
        }));

        Assert.Equal(409, ex.StatusCode);
        Assert.Contains("size", ex.Message, StringComparison.OrdinalIgnoreCase);
        detectorClient.Verify(d => d.NotifyModelUpdateAsync(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task CreateUploadSession_CleansExpiredStagingUploads()
    {
        await using var db = CreateDbContext();

        var blobStorage = new Mock<IBlobStorageService>();
        blobStorage
            .Setup(b => b.DeleteObjectsOlderThanAsync("models/uploads/", It.IsAny<DateTime>(), null))
            .ReturnsAsync(2);
        blobStorage
            .Setup(b => b.CreatePresignedUploadUrlAsync(It.IsAny<string>(), It.IsAny<int>()))
            .ReturnsAsync("https://storage.test/model-cycle-storage/models/uploads/abc/v2.0.1.pt");

        var detectorClient = new Mock<IDetectorClientService>();
        var service = CreateService(db, blobStorage, detectorClient);

        var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
        {
            Version = "v2.0.1",
            FileName = "weights.pt",
            FileSize = 123,
        });

        Assert.Equal("PUT", session.UploadMethod);
        blobStorage.Verify(
            b => b.DeleteObjectsOlderThanAsync(
                "models/uploads/",
                It.Is<DateTime>(cutoff =>
                    cutoff <= DateTime.UtcNow.AddMinutes(-59) &&
                    cutoff >= DateTime.UtcNow.AddMinutes(-61)),
                null
            ),
            Times.Once
        );
    }

    [Fact]
    public async Task CreateUploadSession_ContinuesWhenCleanupFails()
    {
        await using var db = CreateDbContext();

        var blobStorage = new Mock<IBlobStorageService>();
        blobStorage
            .Setup(b => b.DeleteObjectsOlderThanAsync("models/uploads/", It.IsAny<DateTime>(), null))
            .ThrowsAsync(new InvalidOperationException("cleanup failed"));
        blobStorage
            .Setup(b => b.CreatePresignedUploadUrlAsync(It.IsAny<string>(), It.IsAny<int>()))
            .ReturnsAsync("https://storage.test/model-cycle-storage/models/uploads/abc/v2.0.1.pt");

        var detectorClient = new Mock<IDetectorClientService>();
        var service = CreateService(db, blobStorage, detectorClient);

        var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
        {
            Version = "v2.0.1",
            FileName = "weights.pt",
            FileSize = 123,
        });

        Assert.Equal("PUT", session.UploadMethod);
        blobStorage.Verify(b => b.CreatePresignedUploadUrlAsync(It.IsAny<string>(), It.IsAny<int>()), Times.Once);
    }
}
