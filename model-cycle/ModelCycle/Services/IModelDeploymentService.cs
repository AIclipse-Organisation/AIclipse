using ModelCycle.DTOs;
using ModelCycle.Models;

namespace ModelCycle.Services;

public interface IModelDeploymentService
{
    Task<CreateModelUploadSessionResponse> CreateUploadSessionAsync(CreateModelUploadSessionRequest request);
    Task<ModelWeights> FinalizeUploadedModelAsync(FinalizeModelUploadRequest request);
    Task<ModelWeights> UploadAndDeployModelAsync(
        Stream modelStream,
        string fileName,
        string contentType,
        ModelWeights newModelWeights,
        List<ModelImageLink> imageLinks);
}