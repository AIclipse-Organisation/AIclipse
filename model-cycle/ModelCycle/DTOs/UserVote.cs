public class UserVoteDto
{
    public required string UserId { get; set; }
    public bool IsAiVote { get; set; } // True if they voted AI, False if Real
}