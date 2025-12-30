using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace ModelCycle.Models;


public class TrainingImage
{
    [Key]
    public Guid Id { get; set; }
    
    public Guid PostId { get; set; } 

    public string MediaImageId { get; set; } 
    public string S3Key { get; set; }
    
    public int UserAiVotes { get; set; }
    public int UserRealVotes { get; set; }
    public double ModelConfidenceScore { get; set; }

    public double CurrentProbability { get; set; }
    public string Label { get; set; }
    
    public TrainingStatus Status { get; set; } = TrainingStatus.Pending; 
    
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}

public enum TrainingStatus
{
    Pending,       
    Ready,      
    UsedInTraining, 
    Rejected     
}
