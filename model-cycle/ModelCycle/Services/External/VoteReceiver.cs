using StackExchange.Redis;
using MongoDB.Driver;
using ModelCycle.Domain;
using ModelCycle.Services.Training;
using System.Linq;

namespace ModelCycle.Services;

public class VoteReceiver : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<VoteReceiver> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    
    private const string StreamKey = "events:model_cycle";
    private const string ConsumerGroup = "model_service_group";
    private const string ConsumerName = "dotnet_worker_1";
    
    private const string PostCollectionName = "community.posts"; 

    public VoteReceiver(
        IConnectionMultiplexer redis, 
        ILogger<VoteReceiver> logger,
        IServiceScopeFactory scopeFactory)
    {
        _redis = redis;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var db = _redis.GetDatabase();
        
        try
        {
            if (!(await db.KeyExistsAsync(StreamKey)) || 
                (await db.StreamGroupInfoAsync(StreamKey)).All(x => x.Name != ConsumerGroup))
            {
                await db.StreamCreateConsumerGroupAsync(StreamKey, ConsumerGroup, StreamPosition.NewMessages);
            }
        }
        catch (RedisServerException ex) when (ex.Message.Contains("BUSYGROUP"))
        {
            // Consumer group already exists; this is expected in concurrent startup and can be safely ignored.
            _logger.LogDebug(ex, "Redis consumer group '{ConsumerGroup}' on stream '{StreamKey}' already exists (BUSYGROUP).", ConsumerGroup, StreamKey);
        }

        _logger.LogInformation("[Model-Cycle] .NET Vote Receiver Started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var entries = await db.StreamReadGroupAsync(StreamKey, ConsumerGroup, ConsumerName, ">", count: 1);

                if (entries == null || entries.Length == 0)
                {
                    await Task.Delay(1000, stoppingToken);
                    continue;
                }

                foreach (var entry in entries)
                {
                    using (var scope = _scopeFactory.CreateScope())
                    {
                        await ProcessMessageAsync(entry, scope.ServiceProvider);
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                    await db.StreamAcknowledgeAsync(StreamKey, ConsumerGroup, entry.Id);
                // Graceful shutdown requested, exit the loop without logging an error.
                return;
            }
            catch (RedisException ex)
            {
                _logger.LogError(ex, "Redis error in VoteReceiver loop");
            }
            catch (Exception ex)
            catch (MongoException ex)
        var postIdField = entry.Values.FirstOrDefault(field => field.Name == "post_id");
        if (postIdField.Name.HasValue)
                _logger.LogError(ex, "MongoDB error in VoteReceiver loop");
            postIdStr = postIdField.Value;
            }
            {
                _logger.LogError(ex, "Error in VoteReceiver loop");
                await Task.Delay(5000, stoppingToken);
            }
        }
    }

    private async Task ProcessMessageAsync(StreamEntry entry, IServiceProvider services)
    {
        string? postIdStr = null;
        foreach (var field in entry.Values)
        {
            if (field.Name == "post_id") postIdStr = field.Value;
        }

        if (postIdStr == null) return;
        
        var mongoDb = services.GetRequiredService<IMongoDatabase>();
        var workflow = services.GetRequiredService<ITrainingWorkflowService>();
        
        var postsCollection = mongoDb.GetCollection<MongoPost>("community.posts");
        var imagesCollection = mongoDb.GetCollection<MongoImage>("images");
        
        var post = await postsCollection
            .Find(p => p.PostId == postIdStr)
            .FirstOrDefaultAsync();

        if (post == null)
        {
            _logger.LogWarning($"[Sync Error] Post {postIdStr} not found in MongoDB!");
            return;
        }
        
        var image = await imagesCollection
            .Find(i => i.ImageId == post.ImageId)
            .FirstOrDefaultAsync();

        if (image == null)
        {
            _logger.LogWarning($"[Data Error] Post {postIdStr} refers to missing Image {post.ImageId}");
            return;
        }
        
        var request = new EvaluateImageRequest
        {
            PostId = post.PostId, 
            MediaImageId = post.ImageId,
            S3Key = image.S3Key,             
            Label = "Unknown", 
            ModelConfidence = image.Score,   
            UserAiVotes = post.UpVotes,       
            UserNotAiVotes = post.DownVotes  
        };

        _logger.LogInformation($"[Evaluating] {post.PostId} | Conf: {image.Score:F2} | Votes: +{post.UpVotes}/-{post.DownVotes}");
        
        try 
        {
            var result = await workflow.ProcessVoteAsync(request);
            
            if (result.IsReadyForTraining)
            {
                _logger.LogInformation($"[Training Set] Image {post.PostId} added to training queue.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"Workflow failed for {postIdStr}");
        }
    }
}