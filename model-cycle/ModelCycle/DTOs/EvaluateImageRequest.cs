namespace ModelCycle.Domain;

public class EvaluateImageRequest
{
    public Guid PostId { get; set; } 

    public string MediaImageId { get; set; } 


    public string S3Key { get; set; } 

    public string Label { get; set; } = "Unknown"; 
    
    public double ModelConfidence { get; set; }

    public int UserAiVotes { get; set; }
    public int UserNotAiVotes { get; set; }
}