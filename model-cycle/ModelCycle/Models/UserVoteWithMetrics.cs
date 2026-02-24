public class UserVoteWithMetrics
{
    public string UserId { get; set; } = string.Empty;

    public bool IsAiVote { get; set; }
    public UserAccuracy Metrics { get; set; } = new();

    public double GetCurrentReliability()
    {
        if (IsAiVote)
        {
            return (Metrics.AdminFakeCorrect + 1.0) / (Metrics.AdminFakeTotal + 2.0);
        }

        return (Metrics.AdminRealCorrect + 1.0) / (Metrics.AdminRealTotal + 2.0);
    }
}