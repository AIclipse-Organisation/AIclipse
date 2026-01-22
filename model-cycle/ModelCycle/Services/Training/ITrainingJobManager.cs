using ModelCycle.Models;

namespace ModelCycle.Services.Training;

public interface ITrainingJobManager
{
    TrainingJobManager.JobScope CreateJobScope();
    Task StageImagesAsync(TrainingJobManager.JobScope scope, List<TrainingImage> newImages, List<TrainingImage> replayImages);
    Task<string> PrepareBaseModelAsync(TrainingJobManager.JobScope scope);
}