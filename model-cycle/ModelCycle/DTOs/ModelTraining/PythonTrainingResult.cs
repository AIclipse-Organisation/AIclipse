using System.Text.Json.Serialization;

namespace ModelCycle.DTOs.ModelTraining;

public class PythonTrainingResult
{
    [JsonPropertyName("validation")]
    public Metrics Validation { get; set; }

    [JsonPropertyName("golden_test")]
    public Metrics GoldenTest { get; set; }

    [JsonPropertyName("epochs_trained")]
    public int EpochsTrained { get; set; }

    [JsonPropertyName("dataset_size")]
    public int DatasetSize { get; set; }
}

public class Metrics
{
    [JsonPropertyName("accuracy")]
    public double Accuracy { get; set; }

    [JsonPropertyName("precision")]
    public double Precision { get; set; }

    [JsonPropertyName("recall")]
    public double Recall { get; set; }

    [JsonPropertyName("f1_score")]
    public double F1Score { get; set; }

    // Specific fields for Golden Set analysis
    [JsonPropertyName("misclass_fake_to_real")]
    public int MisclassFakeToReal { get; set; }

    [JsonPropertyName("misclass_real_to_fake")]
    public int MisclassRealToFake { get; set; }
}