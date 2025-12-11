using System.ComponentModel.DataAnnotations;

namespace ModelCycle.Models;

public class ModelWeights
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public string Version { get; set; } = string.Empty; 

    [Required]
    public string MinioObjectPath { get; set; } = string.Empty; 

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
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
    
    public bool IsDeployed { get; set; } = false; 
    public string? RejectionReason { get; set; } 
    
    //Collection of all images used for the model
    public ICollection<ModelImageLink> ImageLinks { get; set; } = new List<ModelImageLink>();
}