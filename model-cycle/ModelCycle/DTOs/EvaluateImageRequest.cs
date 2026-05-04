namespace ModelCycle.Domain;

public class EvaluateImageRequest
{

    public string PostId { get; set; } = string.Empty;

    public required string MediaImageId { get; set; }


    public string? S3Key { get; set; }

    public string? ModelVersion { get; set; }

    public string Label { get; set; } = "Unknown";

    public double ModelConfidence { get; set; }

    public List<UserVoteDto> Votes { get; set; } = new List<UserVoteDto>();

    public int UserAiVotes => Votes?.Count(v => v.IsAiVote) ?? 0;
    public int UserNotAiVotes => Votes?.Count(v => !v.IsAiVote) ?? 0;

}