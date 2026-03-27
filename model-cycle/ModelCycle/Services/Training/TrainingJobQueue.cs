using System.Threading.Channels;

namespace ModelCycle.Services.Training;

// this queue will ensure 1 training process is ever running at anytime. if any more training triggers, it will be added to the queue.
public class TrainingJobQueue
{
    // channel holds signals to start training
    private readonly Channel<bool> _channel;

    public TrainingJobQueue()
    {
        //only hold 1 pending training at a time
        var options = new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropWrite
        };
        _channel = Channel.CreateBounded<bool>(options);
    }

    public async ValueTask QueueJobAsync()
    {
        // if full will drop the job write
        await _channel.Writer.WriteAsync(true);
    }

    public IAsyncEnumerable<bool> ReadAllAsync(CancellationToken ct)
    {
        return _channel.Reader.ReadAllAsync(ct);
    }
}