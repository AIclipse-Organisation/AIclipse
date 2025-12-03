namespace ModelCycle.Domain;

public class ImageVote
{
    public Guid ImageId { get; set; }
    public int UserAiVotes { get; set; }
    public int UserNotAiVotes { get; set; }
    
    public double ModelConfidence { get; set; }
}