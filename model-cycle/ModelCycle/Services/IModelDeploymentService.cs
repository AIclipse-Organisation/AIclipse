using ModelCycle.Models;

namespace ModelCycle.Services;

public interface IModelDeploymentService
{
    Task<ModelWeights> UploadAndDeployModelAsync(
        Stream modelStream,
        string fileName,
        string contentType,
        ModelWeights newModelWeights,
        List<ModelImageLink> imageLinks);
}