using System.Text.Json.Serialization;

namespace ModelCycle.DTOs;

public class MediaImageResponse
{
    [JsonPropertyName("image_id")]
    public required string ImageId { get; set; }

    [JsonPropertyName("user_id")]
    public required string UserId { get; set; }

    [JsonPropertyName("s3_key")]
    public required string S3Key { get; set; }

    [JsonPropertyName("url")]
    public required string Url { get; set; } 

    [JsonPropertyName("verdict")]
    public required string Verdict { get; set; }

    [JsonPropertyName("label")]
    public required string Label { get; set; }

    [JsonPropertyName("confidence")]
    public required double Confidence { get; set; }

    [JsonPropertyName("is_public")]
    public required bool IsPublic { get; set; }
}