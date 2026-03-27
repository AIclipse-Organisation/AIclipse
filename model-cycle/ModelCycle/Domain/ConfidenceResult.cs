namespace ModelCycle.Domain;

public class ConfidenceResult
{
    public bool IsReadyForTraining { get; set; }
    public double PosteriorMean { get; set; }
    public double Alpha { get; set; }
    public double Beta { get; set; }
    public double Probability { get; set; }
    public required string TrainingLabel { get; set; }
}