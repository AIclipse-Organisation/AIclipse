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
        // will get initial average user's accuracy and use weighted bayesian instead
        // will later change this so that we measure users accuracy and weigh each votes by this measure.
        double userAccuracyAi   = 0.6; 
        double userAccuracyReal = 0.8; 
        
        double modelAccuracyAi = 0.8;
        double modelAccuracyReal = 0.8; 
        
        // Calculate alpha,beta and posterior mean
        double userAi    =  userAccuracyAi   * vote.UserAiVotes;
        double userAiNot       = (1 - userAccuracyReal) * vote.UserNotAiVotes;
        double userReal =  userAccuracyReal * vote.UserNotAiVotes;
        double userRealNot     = (1 - userAccuracyAi)   * vote.UserAiVotes;
        
        double modelAi  =  modelAccuracyAi ;
        double modelAiNot      = (1 - modelAccuracyReal);
        double modelReal=  modelAccuracyReal;
        double modelRealNot   = (1 - modelAccuracyAi);
        
        double alpha = 1 + userAi + userAiNot + modelAi + modelAiNot;

        double beta = 1 + userReal + userRealNot + modelReal + modelRealNot;

        double posteriorMean = alpha / (alpha + beta);

        // Find label
        string trainingLabel = posteriorMean >= 0.5 ? "ai" : "real";

        // find probability of decided label
        double pReal = _beta.Cdf(0.5, alpha, beta);  
        double pAi   = 1.0 - pReal;                     
        double probability = trainingLabel == "ai" ? pAi : pReal;

        //passes threshold of agreement? Will change based on results from research (Ongoing)
        double agreementThreshold = 0.9;
        bool isReady = probability >= agreementThreshold;

        return new ConfidenceResult
        {
            IsReadyForTraining = isReady,
            PosteriorMean = posteriorMean,
            Alpha = alpha,
            Beta = beta,
            Probability = probability,
            TrainingLabel = posteriorMean >= 0.5 ? "ai" : "real"
        };
    }
}