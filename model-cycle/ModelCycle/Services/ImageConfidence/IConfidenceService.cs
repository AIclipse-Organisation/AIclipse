using ModelCycle.Domain;

namespace ModelCycle.Services.ImageConfidence;

public interface IConfidenceService
{
    ConfidenceResult Evaluate(VoteData voteData);
}