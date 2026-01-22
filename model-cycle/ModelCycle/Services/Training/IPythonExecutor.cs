namespace ModelCycle.Services.Training;

public interface IPythonExecutor
{
    Task<bool> RunTrainingAsync(TrainingJobManager.JobScope scope, string baseModelPath);
}