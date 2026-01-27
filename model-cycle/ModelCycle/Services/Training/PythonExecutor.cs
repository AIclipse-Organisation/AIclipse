using System.Diagnostics;
using System.Text;

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
            Arguments = $"-u {PYTHON_SCRIPT_NAME} --data_dir \"{scope.DataDir}\" --golden_dir \"{scope.GoldenDir}\" --base_model_path \"{baseModelPath}\" --output_dir \"{scope.OutputDir}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        var outputBuilder = new StringBuilder();
        var errorBuilder = new StringBuilder();

        try 
        {
            using var process = new Process();
            process.StartInfo = startInfo;
            
            process.OutputDataReceived += (sender, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    outputBuilder.AppendLine(e.Data);
                    _logger.LogInformation("[Python] {Data}", e.Data);
                }
            };
            
            process.ErrorDataReceived += (sender, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    errorBuilder.AppendLine(e.Data);
                    _logger.LogWarning("[Python ErrorStream] {Data}", e.Data);
                }
            };

            if (!process.Start()) 
            {
                _logger.LogError("Failed to start Python process.");
                return false;
            }
            
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.WaitForExitAsync();

            if (process.ExitCode != 0)
            {
                _logger.LogError("Python script failed with Exit Code {Code}.\nFull Error Log:\n{Error}", 
                    process.ExitCode, errorBuilder.ToString());
                return false;
            }

            _logger.LogInformation("Python script finished successfully.");
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception running Python process.");
            return false;
        }
    }
}