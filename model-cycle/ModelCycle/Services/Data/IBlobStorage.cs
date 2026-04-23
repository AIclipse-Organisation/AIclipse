namespace ModelCycle.Services;

public interface IBlobStorageService
{
    Task InitializeAsync();
    Task<string> UploadFileAsync(Stream fileStream, string folder, string fileName, string contentType);
    Task CopyObjectAsync(string sourceObjectName, string destinationObjectName, string? bucketName = null);
    Task<int> DeleteObjectsOlderThanAsync(string prefix, DateTime olderThanUtc, string? bucketName = null);
    Task<BlobObjectInfo?> StatObjectAsync(string objectName, string? bucketName = null);
    Task DownloadFileAsync(string objectKey, string outputPath, string? bucketName = null);
    Task DeleteFileAsync(string objectName, string? bucketName = null);
}
