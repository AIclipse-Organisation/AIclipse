namespace ModelCycle.Domain;

public class ImageVote
{
    public int UserAiVotes { get; set; }
    public int UserNotAiVotes { get; set; }
    
    public double ModelConfidence { get; set; }
}