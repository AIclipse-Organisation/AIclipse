using System;
using ModelCycle.Domain;

namespace ModelCycle.Services.ImageConfidence;

public class ConfidenceService: IConfidenceService
{
    private readonly IBetaDistribution _beta;

    public ConfidenceService(IBetaDistribution beta)
    {
        _beta = beta;
    }
    
    public ConfidenceResult Evaluate(ImageVote vote)
    {
        // User averages found in research - (will later be dynamic per user)
        double userAccuracyAi  = 0.8; 
        double userAccuracyReal = 0.8; 
        
        // Model accuracy - will get from model versioning history later
        double modelAccuracyAi = 0.8;
        double modelAccuracyReal = 0.8;
        
        double userAi = userAccuracyAi * vote.UserAiVotes;
        double userAiNot = (1 - userAccuracyReal)  * vote.UserNotAiVotes;
        double userReal = userAccuracyReal * vote.UserNotAiVotes;
        double userRealNot = (1 - userAccuracyAi)  * vote.UserAiVotes;

        double modelAi = vote.ModelConfidence * modelAccuracyAi;
        double modelAiNot = (1 - vote.ModelConfidence) * (1 - modelAccuracyReal);

        double modelReal = (1 - vote.ModelConfidence) * modelAccuracyReal;
        double modelRealNot = vote.ModelConfidence * (1 - modelAccuracyAi);
        
        double alpha = 1 + userAi + userAiNot + modelAi + modelAiNot;
        double beta = 1 + userReal + userRealNot + modelReal + modelRealNot;

        double posteriorMean = alpha / (alpha + beta);
        
        string trainingLabel = posteriorMean >= 0.5 ? "ai" : "real";

        //Get probability of chosen label and check against threshold
        double pReal = _beta.Cdf(0.5, alpha, beta);
        double pAi   = 1.0 - pReal;

        double probability = trainingLabel == "ai" ? pAi : pReal;
        Console.WriteLine("Probability: " + probability);
        bool isReady = probability >= 0.8;

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