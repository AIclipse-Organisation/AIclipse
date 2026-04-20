namespace ModelCycle.DTOs;

public class CreateModelUploadSessionResponse
{
    public string UploadId { get; set; } = string.Empty;
    public string UploadUrl { get; set; } = string.Empty;
    public string UploadMethod { get; set; } = "PUT";
    public Dictionary<string, string> UploadHeaders { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public DateTime ExpiresAt { get; set; }
}
