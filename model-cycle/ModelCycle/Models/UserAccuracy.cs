using System.Text.Json.Serialization;

public class UserAccuracy
{
    [JsonPropertyName("user_id")]
    public string UserId { get; set; } = string.Empty;

    [JsonPropertyName("admin_fake_correct")]
    public int AdminFakeCorrect { get; set; }

    [JsonPropertyName("admin_fake_total")]
    public int AdminFakeTotal { get; set; }

    [JsonPropertyName("admin_real_correct")]
    public int AdminRealCorrect { get; set; }

    [JsonPropertyName("admin_real_total")]
    public int AdminRealTotal { get; set; }
}