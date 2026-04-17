namespace ModelCycle.Services.Data;

public class DatasetService : IDatasetService
{
    private readonly IBlobStorageService _blobService;
    private readonly string _storagePath; 
    
    public DatasetService(IBlobStorageService blobService, IConfiguration config)
    {
        _blobService = blobService;
        
        string root = config["TRAINING_DATA_PATH"] ?? Path.Combine(Directory.GetCurrentDirectory(), "data");
        _storagePath = Path.Combine(root, "images"); 
        
        if (!Directory.Exists(_storagePath)) Directory.CreateDirectory(_storagePath);
    }
    
    public string GetLocalFilePath(string mediaId)
    {
        var supportedExtensions = new[] { ".jpg", ".jpeg", ".png" };

        foreach (var ext in supportedExtensions)
        {
            var path = Path.Combine(_storagePath, $"{mediaId}{ext}");
            if (File.Exists(path))
            {
                return path;
            }
        }
        return Path.Combine(_storagePath, $"{mediaId}.jpg");
    }

    public async Task SaveImageAsync(string mediaId, string s3Key)
    {
        string extension = Path.GetExtension(s3Key);
        if (string.IsNullOrEmpty(extension)) extension = ".jpg";

        string filePath = Path.Combine(_storagePath, $"{mediaId}{extension}");

        if (File.Exists(filePath)) return; 

        Console.WriteLine($"[DatasetService] Downloading authenticated: {s3Key}");
        
        await _blobService.DownloadFileAsync(s3Key, filePath, "images");
    }
    
    public Task DeleteImageAsync(string mediaId)
    {
        var supportedExtensions = new[] { ".jpg", ".jpeg", ".png" };
        foreach (var ext in supportedExtensions)
        {
            var filePath = Path.Combine(_storagePath, $"{mediaId}{ext}");
            if (File.Exists(filePath)) try { File.Delete(filePath); break; } catch {}
        }
        return Task.CompletedTask;
    }
}
