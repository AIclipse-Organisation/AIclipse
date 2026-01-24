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
    
    public ConfidenceResult Evaluate(VoteData voteData)
    {
        // TODO - Add these to the hosted variables
        // User averages found in research - Added in
        double userAccuracyAi  = 0.8; 
        double userAccuracyReal = 0.8; 
        
        // TODO - Add these to the hosted variables
        // Model accuracy - will get from model versioning history later
        double modelAccuracyAi = 0.8;
        double modelAccuracyReal = 0.8;
        
        double userAi = userAccuracyAi * voteData.UserAiVotes;
        double userAiNot = (1 - userAccuracyReal)  * voteData.UserNotAiVotes;
        double userReal = userAccuracyReal * voteData.UserNotAiVotes;
        double userRealNot = (1 - userAccuracyAi)  * voteData.UserAiVotes;

        double modelAi = voteData.ModelConfidence * modelAccuracyAi;
        double modelAiNot = (1 - voteData.ModelConfidence) * (1 - modelAccuracyReal);

        double modelReal = (1 - voteData.ModelConfidence) * modelAccuracyReal;
        double modelRealNot = voteData.ModelConfidence * (1 - modelAccuracyAi);
        
        double alpha = 1 + userAi + userAiNot + modelAi + modelAiNot;
        double beta = 1 + userReal + userRealNot + modelReal + modelRealNot;

        double posteriorMean = alpha / (alpha + beta);
        
        string trainingLabel = posteriorMean >= 0.5 ? "ai" : "real";

        //Get probability of chosen label and check against threshold
        double pReal = _beta.Cdf(0.5, alpha, beta);
        double pAi   = 1.0 - pReal;

        double probability = trainingLabel == "ai" ? pAi : pReal;
        Console.WriteLine("Votes: AI - " + voteData.UserAiVotes + ", NotAI - " + voteData.UserNotAiVotes);
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