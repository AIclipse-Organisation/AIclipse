using MongoDB.Bson.Serialization.Attributes;

namespace ModelCycle.Domain;

[BsonIgnoreExtraElements]
public class MongoImage
{
    [BsonElement("image_id")]
    public string ImageId { get; set; } = string.Empty;

    [BsonElement("s3_key")] 
    public string S3Key { get; set; } = string.Empty;

    [BsonElement("score")]
    public double Score { get; set; } 
}