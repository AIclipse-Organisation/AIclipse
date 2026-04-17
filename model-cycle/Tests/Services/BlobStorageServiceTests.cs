using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Minio;
using Minio.DataModel.Args;
using ModelCycle.Services;
using Moq;
using Xunit;

namespace Tests.Services;

public class BlobStorageServiceTests
{
    [Fact]
    public void Dispose_DisposesOwnedMinioClientsOnlyOnce()
    {
        var internalClient = new Mock<IMinioClient>();
        var publicClient = new Mock<IMinioClient>();
        var service = new BlobStorageService(
            internalClient.Object,
            publicClient.Object,
            "model-cycle-storage",
            NullLogger<BlobStorageService>.Instance
        );

        service.Dispose();
        service.Dispose();

        internalClient.Verify(client => client.Dispose(), Times.Once);
        publicClient.Verify(client => client.Dispose(), Times.Once);
    }

    [Fact]
    public void Dispose_DoesNotDoubleDisposeSharedMinioClient()
    {
        var client = new Mock<IMinioClient>();
        var service = new BlobStorageService(
            client.Object,
            client.Object,
            "model-cycle-storage",
            NullLogger<BlobStorageService>.Instance
        );

        service.Dispose();

        client.Verify(minioClient => minioClient.Dispose(), Times.Once);
    }

    [Fact]
    public async Task CreatePresignedUploadUrlAsync_RewritesSchemeFromExternalProto()
    {
        var internalClient = new Mock<IMinioClient>();
        var publicClient = new Mock<IMinioClient>();
        publicClient
            .Setup(client => client.PresignedPutObjectAsync(It.IsAny<PresignedPutObjectArgs>()))
            .ReturnsAsync("http://storage.aiclipse.local/model-cycle-storage/models/uploads/abc/v5.pt?sig=123");
        var service = new BlobStorageService(
            internalClient.Object,
            publicClient.Object,
            "model-cycle-storage",
            NullLogger<BlobStorageService>.Instance
        );

        var url = await service.CreatePresignedUploadUrlAsync(
            "models/uploads/abc/v5.pt",
            3600,
            "https"
        );

        Assert.Equal(
            "https://storage.aiclipse.local/model-cycle-storage/models/uploads/abc/v5.pt?sig=123",
            url
        );
    }
}
