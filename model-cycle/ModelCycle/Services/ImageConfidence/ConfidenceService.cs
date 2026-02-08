using System;
using Microsoft.Extensions.Options;
using ModelCycle.Domain;
using ModelCycle.Models;

namespace ModelCycle.Services.ImageConfidence;

public class ConfidenceService : IConfidenceService
{
    private readonly IBetaDistribution _beta;
    private readonly ModelCycleConfig _config;

    public ConfidenceService(IBetaDistribution beta, IOptions<ModelCycleConfig> config)
    {
        _beta = beta;
        _config = config.Value;
    }

    public ConfidenceResult Evaluate(VoteData voteData, ModelWeights modelWeights)
    {
        double probabilityOfAi;

        if (voteData.Label != null && voteData.Label.Equals("real", StringComparison.OrdinalIgnoreCase))
        {
            probabilityOfAi = 1.0 - voteData.ModelConfidence;
        }
        else
        {
            probabilityOfAi = voteData.ModelConfidence;
        }

        double userAccuracyAi = _config.UserAccuracyAi;
        double userAccuracyReal = _config.UserAccuracyReal;

        double modelAccuracyAi = modelWeights.GoldenTestPrecision;
        double modelAccuracyReal = modelWeights.GoldenTestRecall;

        double userAi = userAccuracyAi * voteData.UserAiVotes;
        double userAiNot = (1 - userAccuracyReal) * voteData.UserNotAiVotes;
        double userReal = userAccuracyReal * voteData.UserNotAiVotes;
        double userRealNot = (1 - userAccuracyAi) * voteData.UserAiVotes;

        double modelAi = probabilityOfAi * modelAccuracyAi;
        double modelAiNot = (1 - probabilityOfAi) * (1 - modelAccuracyReal);

        double modelReal = (1 - probabilityOfAi) * modelAccuracyReal;
        double modelRealNot = probabilityOfAi * (1 - modelAccuracyAi);

        double alpha = 1 + userAi + userAiNot + modelAi + modelAiNot;
        double beta = 1 + userReal + userRealNot + modelReal + modelRealNot;

        double posteriorMean = alpha / (alpha + beta);

        string trainingLabel = posteriorMean >= 0.5 ? "ai" : "real";
        double pReal = _beta.Cdf(0.5, alpha, beta);
        double pAi = 1.0 - pReal;
        double probability = trainingLabel == "ai" ? pAi : pReal;

        Console.WriteLine($"[Confidence] Normalized P(AI): {probabilityOfAi:F3} (Original: {voteData.ModelConfidence} | {voteData.Label})");
        Console.WriteLine($"[Confidence] Final Prob: {probability:P}");

        bool isReady = probability >= _config.ConfidenceThreshold;

        return new ConfidenceResult
        {
            IsReadyForTraining = isReady,
            PosteriorMean = posteriorMean,
            Alpha = alpha,
            Beta = beta,
            Probability = probability,
            TrainingLabel = trainingLabel
        };
    }
}