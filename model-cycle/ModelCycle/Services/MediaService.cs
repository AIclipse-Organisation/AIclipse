using System.Net;
using System.Text.Json;
using ModelCycle.DTOs;

namespace ModelCycle.Services;

public class MediaService : IMediaService
{
    private readonly HttpClient _httpClient;

    public MediaService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<MediaImageResponse?> GetImageMetadataAsync(string mediaImageId)
    {
        var response = await _httpClient.GetAsync($"image/{mediaImageId}");

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null; 
        }

        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        
        return JsonSerializer.Deserialize<MediaImageResponse>(content);
    }
}