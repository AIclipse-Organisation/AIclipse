using Microsoft.Extensions.Configuration;
using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;

namespace ModelCycle.Services.Data;

public class DatasetService : IDatasetService
{
    private readonly HttpClient _httpClient;
    private readonly string _storagePath; 

    public DatasetService(HttpClient httpClient, IConfiguration config)
    {
        _httpClient = httpClient;
        string root = config["TRAINING_DATA_PATH"] ?? Path.Combine(Directory.GetCurrentDirectory(), "data");
        _storagePath = Path.Combine(root, "images"); 
        
        // ensure the directory is made
        if (!Directory.Exists(_storagePath))
        {
            Directory.CreateDirectory(_storagePath);
        }
    }

    public async Task SaveImageAsync(string mediaId, string downloadUrl)
    {
        string extension = Path.GetExtension(downloadUrl);
        if (extension.Contains('?'))
        {
            extension = extension.Split('?')[0];
        }
        if (string.IsNullOrEmpty(extension)) 
        {
            extension = ".jpg";
        }

        string filePath = Path.Combine(_storagePath, $"{mediaId}{extension}");
        
        // do nothing if exists already
        if (File.Exists(filePath)) 
        {
            return; 
        }
        
        try 
        {
            // try download
            var imageBytes = await _httpClient.GetByteArrayAsync(downloadUrl);
            await File.WriteAllBytesAsync(filePath, imageBytes);
        }
        catch (Exception)
        {
            // delete file on error, prevent corruption of files
            if (File.Exists(filePath)) 
            {
                try { File.Delete(filePath); } catch { /* ignore secondary error */ }
            }
            throw;
        }
    }
    
    public Task DeleteImageAsync(string mediaId)
    {
        var supportedExtensions = new[] { ".jpg", ".jpeg", ".png", ".webp" };

        foreach (var ext in supportedExtensions)
        {
            var filePath = Path.Combine(_storagePath, $"{mediaId}{ext}");
            try
            {
                if (File.Exists(filePath))
                {
                    File.Delete(filePath);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Failed to delete {filePath}: {ex.Message}");
            }
        }

        return Task.CompletedTask;
    }
}