namespace ModelCycle.DTOs;

public class CreateModelUploadSessionResponse
{
    public string UploadId { get; set; } = string.Empty;
    public string UploadMethod { get; set; } = "PUT";
    public int PartSizeBytes { get; set; }
    public int TotalParts { get; set; }
    public DateTime ExpiresAt { get; set; }
}
