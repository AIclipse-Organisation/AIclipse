using MongoDB.Bson.Serialization.Attributes;

namespace ModelCycle.Domain;

[BsonIgnoreExtraElements]
public class MongoPost
{
    [BsonElement("post_id")]
    public string PostId { get; set; } = string.Empty;

    [BsonElement("image_id")] 
    public string ImageId { get; set; } = string.Empty;

    [BsonElement("up_vote_count")]
    public int UpVotes { get; set; }

    [BsonElement("down_vote_count")]
    public int DownVotes { get; set; }
}