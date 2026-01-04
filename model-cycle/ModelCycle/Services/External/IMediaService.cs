using ModelCycle.DTOs;

namespace ModelCycle.Services;

public interface IMediaService
{
    Task<MediaImageResponse?> GetImageMetadataAsync(string mediaImageId);
}