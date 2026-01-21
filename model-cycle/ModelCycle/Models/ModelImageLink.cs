using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ModelCycle.Models;

public class ModelImageLink
{
    [Key]
    public Guid Id { get; set; }
    
    [Required]
    public Guid ModelWeightId { get; set; }
    [ForeignKey("ModelWeightId")]
    public ModelWeights ModelWeight { get; set; }
    
    
    [Required]
    public Guid TrainingImageId { get; set; }
    [ForeignKey("TrainingImageId")]
    public TrainingImage TrainingImage { get; set; }

    // To link what the image was used for to the model it was used with.
    [Required]
    public ImageUsageType UsageType { get; set; }
}