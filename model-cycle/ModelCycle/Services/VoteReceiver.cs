using StackExchange.Redis;

namespace ModelCycle.Services;

public class VoteReceiver : BackgroundService
{
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<VoteReceiver> _logger;
    
    private const string StreamKey = "events:model_cycle";
    private const string ConsumerGroup = "model_service_group";
    private const string ConsumerName = "dotnet_worker_1"; 

    public VoteReceiver(IConnectionMultiplexer redis, ILogger<VoteReceiver> logger)
    {
        _redis = redis;
        _logger = logger;
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
            // ignore
        }

        _logger.LogInformation("[Model-Cycle] .NET Receiver Started. Listening...");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var entries = await db.StreamReadGroupAsync(
                    StreamKey,
                    ConsumerGroup,
                    ConsumerName,
                    StreamPosition.NewMessages, 
                    count: 1
                );

                if (entries == null || entries.Length == 0)
                {
                    await Task.Delay(1000, stoppingToken);
                    continue;
                }

                foreach (var entry in entries)
                {
                    await ProcessMessageAsync(entry, db);
                    await db.StreamAcknowledgeAsync(StreamKey, ConsumerGroup, entry.Id);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing Redis stream");
                await Task.Delay(5000, stoppingToken);
            }
        }
    }

    private async Task ProcessMessageAsync(StreamEntry entry, IDatabase db)
    {
        string postId = null;
        int deltaUp = 0;
        int deltaDown = 0;

        foreach (var field in entry.Values)
        {
            if (field.Name == "post_id") postId = field.Value;
            else if (field.Name == "delta_up") deltaUp = (int)field.Value;
            else if (field.Name == "delta_down") deltaDown = (int)field.Value;
        }

        if (postId != null)
        {
            _logger.LogInformation($"[Event Received] Post: {postId} | Up: {deltaUp} | Down: {deltaDown}");

            // ---------------------------------------------------------
            // TODO: YOUR MODEL LOGIC GOES HERE
            // ---------------------------------------------------------
            
            await Task.Delay(10); // Simulate work
        }
    }
}