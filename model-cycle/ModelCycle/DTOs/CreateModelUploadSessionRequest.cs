using System.ComponentModel.DataAnnotations;

namespace ModelCycle.DTOs;

public class CreateModelUploadSessionRequest
{
    [Required]
    public string Version { get; set; } = string.Empty;

    [Required]
    public string FileName { get; set; } = string.Empty;

    [Range(1, 786432000)]
    public long FileSize { get; set; }

    public string? ContentType { get; set; }
}
