using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace ModelCycle.Models;


public class TrainingImage
{
    [Key]
    public Guid Id { get; set; }
    
    [Required]
    public Guid OriginalBucketId { get; set; }

    [Required]
    public string MinioObjectPath { get; set; } = string.Empty; 

    [Required]

    public string? Label { get; set; } 

    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}