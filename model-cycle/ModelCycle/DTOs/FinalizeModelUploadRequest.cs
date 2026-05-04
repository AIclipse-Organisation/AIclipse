using System.ComponentModel.DataAnnotations;

namespace ModelCycle.DTOs;

public class FinalizeModelUploadRequest
{
    [Required]
    public string UploadId { get; set; } = string.Empty;

    [Required]
    public string Version { get; set; } = string.Empty;

    [Range(0, int.MaxValue)]
    public int NewImagesCount { get; set; }

    [Range(0, int.MaxValue)]
    public int ReplayBufferCount { get; set; }

    public double ValidationAccuracy { get; set; }
    public double ValidationPrecision { get; set; }
    public double ValidationRecall { get; set; }
    public double ValidationF1Score { get; set; }
    public double GoldenTestAccuracy { get; set; }
    public double GoldenTestPrecision { get; set; }
    public double GoldenTestRecall { get; set; }
    public double GoldenTestF1Score { get; set; }

    [Range(0, int.MaxValue)]
    public int GoldenFakeToRealMisclassifications { get; set; }

    [Range(0, int.MaxValue)]
    public int GoldenRealToFakeMisclassifications { get; set; }

    public List<Guid>? NewTrainingImageIds { get; set; }
    public List<Guid>? ReplayImageIds { get; set; }
    public List<Guid>? GoldenTestImageIds { get; set; }
}
