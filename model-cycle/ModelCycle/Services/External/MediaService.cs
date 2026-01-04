using System.Net;
using System.Text.Json;
using ModelCycle.DTOs; 

namespace ModelCycle.Services.External;

public class MediaService : IMediaService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<MediaService> _logger; 
    
    public MediaService(HttpClient httpClient, ILogger<MediaService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<MediaImageResponse?> GetImageMetadataAsync(string mediaImageId)
    {
        try
        {
            var response = await _httpClient.GetAsync($"image/{mediaImageId}");

            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                _logger.LogWarning("MediaService returned 404 for Image ID: {MediaId}", mediaImageId);
                return null; 
            }
            response.EnsureSuccessStatusCode();

            var content = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<MediaImageResponse>(content);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Network error calling MediaService for ID: {MediaId}", mediaImageId);
            throw; 
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Failed to deserialize response from MediaService for ID: {MediaId}", mediaImageId);
            throw;
        }
    }
}