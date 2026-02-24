using StackExchange.Redis;
using MongoDB.Driver;
using ModelCycle.Domain;
using ModelCycle.Services.Training;
using System.Linq;
using System.Text.Json;

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
            _logger.LogDebug("Redis consumer group '{ConsumerGroup}' already exists.", ConsumerGroup);
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
                    }

                    await db.StreamAcknowledgeAsync(StreamKey, ConsumerGroup, entry.Id);
                }
            }
            catch (OperationCanceledException)
            {
                // Graceful shutdown
                break;
            }
            catch (RedisException ex)
            {
                _logger.LogError(ex, "Redis error in VoteReceiver loop");
                await Task.Delay(5000, stoppingToken);
            }
            catch (MongoException ex)
            {
                _logger.LogError(ex, "MongoDB error in VoteReceiver loop");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error in VoteReceiver loop");
            }
        }
    }


    private async Task ProcessMessageAsync(StreamEntry entry, IServiceProvider services)
    {
        string? postIdStr = entry.Values.FirstOrDefault(f => f.Name == "post_id").Value;
        if (string.IsNullOrEmpty(postIdStr)) return;

        var mongoDb = services.GetRequiredService<IMongoDatabase>();
        var workflow = services.GetRequiredService<ITrainingWorkflowService>();

        var postsCol = mongoDb.GetCollection<MongoPost>("community.posts");
        var imagesCol = mongoDb.GetCollection<MongoImage>("images");

        var post = await postsCol.Find(p => p.PostId == postIdStr).FirstOrDefaultAsync();
        if (post == null)
        {
            _logger.LogWarning($"[Sync Error] Post {postIdStr} not found in MongoDB!");
            return;
        }

        var image = await imagesCol.Find(i => i.ImageId == post.ImageId).FirstOrDefaultAsync();
        if (image == null)
        {
            _logger.LogWarning($"[Data Error] Post {postIdStr} refers to missing Image {post.ImageId}");
            return;
        }


        var votesCol = mongoDb.GetCollection<MongoVote>("community.votes");
        var allVotesDocs = await votesCol.Find(v => v.PostId == postIdStr).ToListAsync();

        var individualVotes = allVotesDocs.Select(v => new UserVoteDto
        {
            UserId = v.UserId,
            IsAiVote = v.Vote.Equals("up", StringComparison.OrdinalIgnoreCase)
        }).ToList();

        var request = new EvaluateImageRequest
        {
            PostId = post.PostId,
            MediaImageId = post.ImageId,
            S3Key = image.S3Key,
            Label = "ai",
            ModelConfidence = (float)image.Score,
            Votes = individualVotes
        };

        _logger.LogInformation(
            "[Evaluating] {PostId} | Total Historical Voters: {Count} | Model Score: {Score:F2}",
            post.PostId,
            individualVotes.Count,
            image.Score
        );

        try
        {
            await workflow.ProcessVoteAsync(request);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"Workflow failed for {postIdStr}");
        }
    }
}