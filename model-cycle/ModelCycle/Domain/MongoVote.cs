using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

[BsonIgnoreExtraElements]
public class MongoVote
{
    [BsonElement("post_id")]
    public string PostId { get; set; } = string.Empty;

    [BsonElement("user_id")]
    public string UserId { get; set; } = string.Empty;

    [BsonElement("vote")]
    public string Vote { get; set; } = string.Empty; // "up" or "down"
}