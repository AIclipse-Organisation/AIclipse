using System.Text.Json;
using System.Text.Json.Serialization;

namespace ModelCycle;

public class ModelCycleConfig
{
    [JsonPropertyName("BATCH_SIZE_THRESHOLD")]
    public int BatchSizeThreshold { get; set; }

    [JsonPropertyName("REPLAY_BUFFER_RATIO")]
    public double ReplayBufferRatio { get; set; }

    public static ModelCycleConfig LoadModelConfig(string filePath)
    {
        string currentEnv = Environment.GetEnvironmentVariable("APP_ENV") ?? "dev";
        Console.WriteLine($"[Config] Detected Environment: '{currentEnv}'");
        
        if (!File.Exists(filePath))
        {
            Console.WriteLine($"[Config] CRITICAL ERROR: Config file not found at '{filePath}'");
            throw new FileNotFoundException($"Config file not found at {filePath}");
        }
        try 
        {
            var jsonString = File.ReadAllText(filePath);
            using (JsonDocument doc = JsonDocument.Parse(jsonString))
            {
                if (doc.RootElement.TryGetProperty(currentEnv, out JsonElement envNode))
                {
                    if (envNode.TryGetProperty("model-cycle", out JsonElement cycleNode))
                    {
                        var config = cycleNode.Deserialize<ModelCycleConfig>()!;
                        Console.WriteLine($"[Config] Successfully loaded 'model-cycle' for '{currentEnv}'.");
                        Console.WriteLine($"[Config] Batch Threshold: {config.BatchSizeThreshold}, Replay Ratio: {config.ReplayBufferRatio}");
                        
                        return config;
                    }
                    else
                    {
                        throw new Exception($"Section 'model-cycle' missing inside '{currentEnv}'");
                    }
                }
                else
                {
                    throw new Exception($"Environment '{currentEnv}' not found in JSON root.");
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Config] ERROR parsing config: {ex.Message}");
            throw; 
        }
    }
}