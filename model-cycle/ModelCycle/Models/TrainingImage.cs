using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace ModelCycle.Models;


public class TrainingImage
{
    [Key]
    public Guid Id { get; set; }
    
    public string? PostId { get; set; } 

    public required string MediaImageId { get; set; } 
    public required string S3Key { get; set; }
    
    public int UserAiVotes { get; set; }
    public int UserRealVotes { get; set; }
    public double ModelConfidenceScore { get; set; }

    public double CurrentProbability { get; set; }
    public required string Label { get; set; }
    
    public TrainingStatus Status { get; set; } = TrainingStatus.Pending; 
    
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    
    public string? ModelVersion { get; set; } =  null;
}

public enum TrainingStatus
{ 
    Pending,       
    Ready,      
    UsedInTraining 
}
