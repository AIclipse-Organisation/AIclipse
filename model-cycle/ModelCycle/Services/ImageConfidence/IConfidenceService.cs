using ModelCycle.Domain;
using ModelCycle.Models;

namespace ModelCycle.Services.ImageConfidence;

public interface IConfidenceService
{
    ConfidenceResult Evaluate(WeightedVoteData voteData, ModelWeights modelWeights);
}