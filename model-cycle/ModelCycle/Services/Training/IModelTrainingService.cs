namespace ModelCycle.Services.Training;

public interface IModelTrainingService
{
    Task<Guid?> RunTrainingCycleAsync();
}