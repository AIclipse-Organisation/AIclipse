namespace ModelCycle.DTOs;

public sealed class FinalizeModelUploadResponse
{
    public string Message { get; set; } = string.Empty;
    public Guid Id { get; set; }
    public string Version { get; set; } = string.Empty;
    public int ImagesLinked { get; set; }
}
