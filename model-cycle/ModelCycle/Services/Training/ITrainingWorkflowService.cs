using ModelCycle.Domain;

namespace ModelCycle.Services.Training;

public interface ITrainingWorkflowService
{
    public Task<ConfidenceResult> ProcessVoteAsync(EvaluateImageRequest request);
}