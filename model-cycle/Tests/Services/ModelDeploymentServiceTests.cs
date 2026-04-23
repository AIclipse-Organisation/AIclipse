#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
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
    private const int MultipartPartSizeBytes = 16 * 1024 * 1024;

    private static AppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static IConfiguration CreateConfiguration(string stagingRootPath)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["TRAINING_DATA_PATH"] = stagingRootPath,
            })
            .Build();
    }

    private static ModelDeploymentService CreateService(
        AppDbContext db,
        Mock<IBlobStorageService> blobStorage,
        Mock<IDetectorClientService> detectorClient,
        string stagingRootPath)
    {
        var dataProtectionProvider = new EphemeralDataProtectionProvider();
        var memoryCache = new MemoryCache(new MemoryCacheOptions());
        return new ModelDeploymentService(
            db,
            blobStorage.Object,
            detectorClient.Object,
            memoryCache,
            dataProtectionProvider,
            CreateConfiguration(stagingRootPath),
            NullLogger<ModelDeploymentService>.Instance
        );
    }

    [Fact]
    public async Task CreateUploadSession_UploadPart_AndFinalize_DeploysStoredModelAndDeactivatesPreviousVersion()
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
        long? uploadedLength = null;
        blobStorage
            .Setup(b => b.StatObjectAsync("models/v2.0.1.pt", null))
            .ReturnsAsync((BlobObjectInfo?)null);
        blobStorage
            .Setup(b => b.UploadFileAsync(It.IsAny<Stream>(), "models", "v2.0.1.pt", "application/octet-stream"))
            .Callback<Stream, string, string, string>((stream, _, _, _) => uploadedLength = stream.Length)
            .ReturnsAsync("models/v2.0.1.pt");

        var detectorClient = new Mock<IDetectorClientService>();
        detectorClient
            .Setup(d => d.NotifyModelUpdateAsync(It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync(true);

        var stagingRootPath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

        try
        {
            var service = CreateService(db, blobStorage, detectorClient, stagingRootPath);

            var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
            {
                Version = "2.0.1",
                FileName = "weights.pt",
                FileSize = 123,
                ContentType = "application/octet-stream",
            });

            Assert.Equal("PUT", session.UploadMethod);
            Assert.Equal(1, session.TotalParts);
            Assert.Equal(MultipartPartSizeBytes, session.PartSizeBytes);

            await using var partStream = new MemoryStream(new byte[123]);
            var uploadedPart = await service.UploadPartAsync(
                session.UploadId,
                1,
                partStream,
                123,
                "application/octet-stream"
            );

            Assert.Equal(1, uploadedPart.PartNumber);

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
            Assert.Equal(123, uploadedLength);
            blobStorage.Verify(
                b => b.UploadFileAsync(
                    It.IsAny<Stream>(),
                    "models",
                    "v2.0.1.pt",
                    "application/octet-stream"
                ),
                Times.Once
            );
            detectorClient.Verify(
                d => d.NotifyModelUpdateAsync("v2.0.1", "models/v2.0.1.pt"),
                Times.Once
            );
        }
        finally
        {
            if (Directory.Exists(stagingRootPath))
            {
                Directory.Delete(stagingRootPath, recursive: true);
            }
        }
    }

    [Fact]
    public async Task FinalizeUpload_RejectsSizeMismatch()
    {
        await using var db = CreateDbContext();

        var blobStorage = new Mock<IBlobStorageService>();
        blobStorage
            .Setup(b => b.StatObjectAsync("models/v2.0.1.pt", null))
            .ReturnsAsync((BlobObjectInfo?)null);

        var detectorClient = new Mock<IDetectorClientService>();
        var stagingRootPath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

        try
        {
            var service = CreateService(db, blobStorage, detectorClient, stagingRootPath);

            var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
            {
                Version = "v2.0.1",
                FileName = "weights.pt",
                FileSize = MultipartPartSizeBytes + 1L,
                ContentType = "application/octet-stream",
            });

            await using var partStream = new MemoryStream(new byte[MultipartPartSizeBytes]);
            await service.UploadPartAsync(
                session.UploadId,
                1,
                partStream,
                MultipartPartSizeBytes,
                "application/octet-stream"
            );

            var ex = await Assert.ThrowsAsync<ModelUploadException>(() => service.FinalizeUploadedModelAsync(new FinalizeModelUploadRequest
            {
                UploadId = session.UploadId,
                Version = "v2.0.1",
            }));

            Assert.Equal(409, ex.StatusCode);
            Assert.Contains("size", ex.Message, StringComparison.OrdinalIgnoreCase);
            detectorClient.Verify(d => d.NotifyModelUpdateAsync(It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        }
        finally
        {
            if (Directory.Exists(stagingRootPath))
            {
                Directory.Delete(stagingRootPath, recursive: true);
            }
        }
    }

    [Fact]
    public async Task UploadPart_RejectsUnexpectedPartSize()
    {
        await using var db = CreateDbContext();

        var blobStorage = new Mock<IBlobStorageService>();
        var detectorClient = new Mock<IDetectorClientService>();
        var stagingRootPath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

        try
        {
            var service = CreateService(db, blobStorage, detectorClient, stagingRootPath);

            var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
            {
                Version = "v2.0.1",
                FileName = "weights.pt",
                FileSize = MultipartPartSizeBytes + 1L,
                ContentType = "application/octet-stream",
            });

            await using var partStream = new MemoryStream(new byte[1]);
            var ex = await Assert.ThrowsAsync<ModelUploadException>(() => service.UploadPartAsync(
                session.UploadId,
                1,
                partStream,
                1,
                "application/octet-stream"
            ));

            Assert.Equal(400, ex.StatusCode);
            Assert.Contains("size", ex.Message, StringComparison.OrdinalIgnoreCase);
            blobStorage.Verify(
                b => b.UploadFileAsync(It.IsAny<Stream>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()),
                Times.Never
            );
        }
        finally
        {
            if (Directory.Exists(stagingRootPath))
            {
                Directory.Delete(stagingRootPath, recursive: true);
            }
        }
    }

    [Fact]
    public async Task UploadPart_RejectsOutOfOrderUploads()
    {
        await using var db = CreateDbContext();

        var blobStorage = new Mock<IBlobStorageService>();
        var detectorClient = new Mock<IDetectorClientService>();
        var stagingRootPath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

        try
        {
            var service = CreateService(db, blobStorage, detectorClient, stagingRootPath);

            var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
            {
                Version = "v2.0.1",
                FileName = "weights.pt",
                FileSize = MultipartPartSizeBytes + 1L,
                ContentType = "application/octet-stream",
            });

            await using var partStream = new MemoryStream(new byte[1]);
            var ex = await Assert.ThrowsAsync<ModelUploadException>(() => service.UploadPartAsync(
                session.UploadId,
                2,
                partStream,
                1,
                "application/octet-stream"
            ));

            Assert.Equal(409, ex.StatusCode);
            Assert.Contains("order", ex.Message, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            if (Directory.Exists(stagingRootPath))
            {
                Directory.Delete(stagingRootPath, recursive: true);
            }
        }
    }

    [Fact]
    public async Task CreateUploadSession_CleansExpiredStagingUploads()
    {
        await using var db = CreateDbContext();

        var blobStorage = new Mock<IBlobStorageService>();
        var detectorClient = new Mock<IDetectorClientService>();
        var stagingRootPath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));

        try
        {
            Directory.CreateDirectory(Path.Combine(stagingRootPath, "admin-upload-staging", "expired"));
            var marker = Path.Combine(stagingRootPath, "admin-upload-staging", "expired", ".upload-session");
            File.WriteAllText(marker, string.Empty);
            File.SetLastWriteTimeUtc(marker, DateTime.UtcNow.AddHours(-2));

            var service = CreateService(db, blobStorage, detectorClient, stagingRootPath);

            var session = await service.CreateUploadSessionAsync(new CreateModelUploadSessionRequest
            {
                Version = "v2.0.1",
                FileName = "weights.pt",
                FileSize = 123,
            });

            Assert.Equal("PUT", session.UploadMethod);
            Assert.False(Directory.Exists(Path.Combine(stagingRootPath, "admin-upload-staging", "expired")));
        }
        finally
        {
            if (Directory.Exists(stagingRootPath))
            {
                Directory.Delete(stagingRootPath, recursive: true);
            }
        }
    }

}
