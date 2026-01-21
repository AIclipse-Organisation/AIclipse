using ModelCycle.Models;

namespace ModelCycle.Services;

public interface IDatasetService
{
    public Task SaveImageAsync(string mediaId, string downloadUrl);

    public Task DeleteImageAsync(string mediaId);
}