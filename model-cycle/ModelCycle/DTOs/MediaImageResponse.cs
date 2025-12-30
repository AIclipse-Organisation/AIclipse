using System.Text.Json.Serialization;

namespace ModelCycle.DTOs;

public class MediaImageResponse
{
    [JsonPropertyName("image_id")]
    public string ImageId { get; set; }

    [JsonPropertyName("user_id")]
    public string UserId { get; set; }

    [JsonPropertyName("s3_key")]
    public string S3Key { get; set; }

    [JsonPropertyName("url")]
    public string Url { get; set; } 

    [JsonPropertyName("verdict")]
    public string Verdict { get; set; }

    [JsonPropertyName("label")]
    public string Label { get; set; }

    [JsonPropertyName("confidence")]
    public double Confidence { get; set; }

    [JsonPropertyName("is_public")]
    public bool IsPublic { get; set; }
}