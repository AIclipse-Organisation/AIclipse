using System.Diagnostics;

namespace ModelCycle.Services.Training;

public class PythonExecutor : IPythonExecutor
{
    private readonly ILogger<PythonExecutor> _logger;
    private const string PYTHON_SCRIPT_NAME = "python_scripts/training.py";

    public PythonExecutor(ILogger<PythonExecutor> logger)
    {
        _logger = logger;
    }

    public async Task<bool> RunTrainingAsync(TrainingJobManager.JobScope scope, string baseModelPath)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "python",
            Arguments = $"{PYTHON_SCRIPT_NAME} --data_dir \"{scope.DataDir}\" --golden_dir \"{scope.GoldenDir}\" --base_model_path \"{baseModelPath}\" --output_dir \"{scope.OutputDir}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        try 
        {
            using var process = Process.Start(startInfo);
            if (process == null) 
            {
                _logger.LogError("Failed to start Python process.");
                return false;
            }
            
            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();

            await process.WaitForExitAsync();

            string output = await outputTask;
            string error = await errorTask;

            if (process.ExitCode != 0)
            {
                _logger.LogError("Python Error (Exit Code {Code}): {Error}", process.ExitCode, error);
                return false;
            }

            _logger.LogInformation("Python Output: {Output}", output);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception running Python process.");
            return false;
        }
    }
}