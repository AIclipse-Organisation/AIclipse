namespace ModelCycle.Domain;

public class VoteData
{
    public Guid PostId { get; set; }
    public int UserAiVotes { get; set; }
    public int UserNotAiVotes { get; set; }
    
    public double ModelConfidence { get; set; }
}