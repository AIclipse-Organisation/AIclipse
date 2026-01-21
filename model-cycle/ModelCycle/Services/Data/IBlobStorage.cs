namespace ModelCycle.Services;

public interface IBlobStorageService
{
    Task InitializeAsync();
    Task<string> UploadFileAsync(Stream fileStream, string objectName, string fileName, string contentType);
    Task DownloadFileAsync(string objectKey, string outputPath, string? bucketName = null);
}