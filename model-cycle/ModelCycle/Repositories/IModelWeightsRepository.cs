using ModelCycle.Models;

namespace ModelCycle.Repositories;

public interface IModelWeightsRepository
{
    Task<ModelWeights?> GetByVersionAsync(string version);
    
    Task<ModelWeights?> GetDeployedModelAsync();
}