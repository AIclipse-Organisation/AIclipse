namespace ModelCycle.Services.Training;

public class QueuedTrainingWorker : BackgroundService
{
    private readonly TrainingJobQueue _queue;
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<QueuedTrainingWorker> _logger;

    public QueuedTrainingWorker(
        TrainingJobQueue queue, 
        IServiceProvider serviceProvider, 
        ILogger<QueuedTrainingWorker> logger)
    {
        _queue = queue;
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // this loop waits for jobs to be in queue and will consume no resources while doing so.
        await foreach (var _ in _queue.ReadAllAsync(stoppingToken))
        {
            try 
            {
                _logger.LogInformation("Training signal received. Starting processing...");

                // Needs access to scope, like the db.
                using var scope = _serviceProvider.CreateScope();
                var trainingService = scope.ServiceProvider.GetRequiredService<IModelTrainingService>();

                //Run training script
                var jobId = await trainingService.RunTrainingCycleAsync();

                if (jobId.HasValue)
                {
                    _logger.LogInformation("Training Job {JobId} completed successfully.", jobId);
                }
                else
                {
                    _logger.LogInformation("Training job checked but found insufficient data.");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred during background training execution.");
            }
        }
    }
}