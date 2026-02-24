public class WeightedVoteData
{
    public string PostId { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public double ModelConfidence { get; set; }
    public List<UserVoteWithMetrics> Votes { get; set; } = new();
}