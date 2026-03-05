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

    public ConfidenceResult Evaluate(WeightedVoteData voteData, ModelWeights modelWeights)
    {
        // 1. Normalize Model Probability
        double probabilityOfAi = voteData.Label.Equals("real", StringComparison.OrdinalIgnoreCase)
            ? 1.0 - voteData.ModelConfidence
            : voteData.ModelConfidence;

        double userAi = 0, userAiNot = 0, userReal = 0, userRealNot = 0;

        Console.WriteLine($"\n[Confidence] --- New Evaluation for Post: {voteData.PostId} ---");
        Console.WriteLine($"[Confidence] Initial Model Confidence (P-AI): {probabilityOfAi:F3} | Label: {voteData.Label}");

        // 2. Process and Log Individual Votes
        foreach (var vote in voteData.Votes)
        {
            double reliability = vote.GetCurrentReliability();
            // Sanitize reliability: if 0 (uninitialized), assume 0.5 (neutral).
            if (reliability <= 0.0001) reliability = 0.5;

            string voteType = vote.IsAiVote ? "AI" : "REAL";

            if (vote.IsAiVote)
            {
                userAi += reliability;
                userRealNot += (1 - reliability);
            }
            else
            {
                userReal += reliability;
                userAiNot += (1 - reliability);
            }

            Console.WriteLine($"[Vote] User: {vote.UserId[..Math.Min(8, vote.UserId.Length)]}... | Vote: {voteType} | Reliability: {reliability:P1}");
        }

        // 3. Calculate Model Influence
        // Sanitize weights: if 0 (uninitialized), assume 0.5 (neutral) to avoid inverting logic.
        // A value of 0.0 would imply the model is always wrong, which generates strong opposite evidence.
        double modelAccuracyAi = modelWeights.GoldenTestPrecision <= 0.0001 ? 0.5 : modelWeights.GoldenTestPrecision;
        double modelAccuracyReal = modelWeights.GoldenTestRecall <= 0.0001 ? 0.5 : modelWeights.GoldenTestRecall;

        double modelAi = probabilityOfAi * modelAccuracyAi;
        double modelAiNot = (1 - probabilityOfAi) * (1 - modelAccuracyReal);
        double modelReal = (1 - probabilityOfAi) * modelAccuracyReal;
        double modelRealNot = probabilityOfAi * (1 - modelAccuracyAi);

        // 4. Bayesian Parameters
        double alpha = 1 + userAi + userAiNot + modelAi + modelAiNot;
        double beta = 1 + userReal + userRealNot + modelReal + modelRealNot;

        double posteriorMean = alpha / (alpha + beta);
        string trainingLabel = posteriorMean >= 0.5 ? "ai" : "real";

        double pReal = _beta.Cdf(0.5, alpha, beta);
        double pAi = 1.0 - pReal;
        double probability = trainingLabel == "ai" ? pAi : pReal;

        bool isReady = probability >= _config.ConfidenceThreshold;

        // 5. Final Result Summary
        Console.WriteLine($"[Stats] Alpha (AI Evidence): {alpha:F2} | Beta (Real Evidence): {beta:F2}");
        Console.WriteLine($"[Stats] Posterior Mean: {posteriorMean:F3} | Result Label: {trainingLabel.ToUpper()}");
        Console.WriteLine($"[Result] Final Probability: {probability:P2} | Ready for Training: {isReady}");
        Console.WriteLine("[Confidence] ---------------------------------------------\n");

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