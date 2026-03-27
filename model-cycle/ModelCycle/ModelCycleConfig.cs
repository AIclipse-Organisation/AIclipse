using System.Text.Json;
using System.Text.Json.Serialization;

namespace ModelCycle;

public class ModelCycleConfig
{
    [JsonPropertyName("BATCH_SIZE_THRESHOLD")]
    public int BatchSizeThreshold { get; set; }

    [JsonPropertyName("REPLAY_BUFFER_RATIO")]
    public double ReplayBufferRatio { get; set; }

    [JsonPropertyName("confidence-scoring")]
    public ConfidenceScoringConfig ConfidenceScoring { get; set; } = new();

    public double UserAccuracyAi => ConfidenceScoring.UserAccuracyAi;
    public double UserAccuracyReal => ConfidenceScoring.UserAccuracyReal;
    public double ConfidenceThreshold => ConfidenceScoring.ConfidenceThreshold;

    public static ModelCycleConfig LoadModelConfig(string filePath)
    {
#if DEBUG
        string currentEnv = "dev";
#else
            string currentEnv = "prod";
#endif

        Console.WriteLine($"[Config] System Mode: {currentEnv}");

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
                        Console.WriteLine($"[Config] Batch: {config.BatchSizeThreshold}, Ratio: {config.ReplayBufferRatio}");
                        Console.WriteLine($"[Config] Confidence Threshold: {config.ConfidenceThreshold}");

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

public class ConfidenceScoringConfig
{
    [JsonPropertyName("USER_ACCURACY_AI")]
    public double UserAccuracyAi { get; set; }

    [JsonPropertyName("USER_ACCURACY_REAL")]
    public double UserAccuracyReal { get; set; }

    [JsonPropertyName("CONFIDENCE_THRESHOLD")]
    public double ConfidenceThreshold { get; set; }
}