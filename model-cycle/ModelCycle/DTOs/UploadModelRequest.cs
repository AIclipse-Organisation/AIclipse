namespace ModelCycle.DTOs;

public class UploadModelRequest
{
    public IFormFile File { get; set; }
    public string Version { get; set; } 
    
    public int NewImagesCount { get; set; }
    public int ReplayBufferCount { get; set; }
    
    public double ValidationAccuracy { get; set; }
    public double ValidationPrecision { get; set; }
    public double ValidationRecall { get; set; }
    public double ValidationF1Score { get; set; }

    public double GoldenTestAccuracy { get; set; }
    public double GoldenTestPrecision { get; set; }
    public double GoldenTestRecall { get; set; }
    public double GoldenTestF1Score { get; set; }
    
    public int GoldenFakeToRealMisclassifications { get; set; }
    public int GoldenRealToFakeMisclassifications { get; set; }
    
    public List<Guid>? NewTrainingImageIds { get; set; }
    public List<Guid>? ReplayImageIds { get; set; }
    public List<Guid>? GoldenTestImageIds { get; set; }
}