using Microsoft.Extensions.Logging.Abstractions;
using Minio;
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
}
