namespace ModelCycle.Domain;

public class VoteData
{
    public string? PostId { get; set; }
    public int UserAiVotes { get; set; }
    public int UserNotAiVotes { get; set; }
    
    public double ModelConfidence { get; set; }
}