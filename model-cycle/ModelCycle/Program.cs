using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using ModelCycle;
using ModelCycle.Data;
using ModelCycle.Services.ImageConfidence;
using ModelCycle.Services.Data;
using ModelCycle.Services.Training;
using ModelCycle.Services;
using ModelCycle.Services.External;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

var redisConnectString = builder.Configuration["Redis:ConnectionString"] ?? "localhost:6379";
builder.Services.AddSingleton<IConnectionMultiplexer>(
    ConnectionMultiplexer.Connect(redisConnectString)
);

string configUrl = Environment.GetEnvironmentVariable("CENTRAL_CONFIG_URL") 
                   ?? throw new Exception("CENTRAL_CONFIG_URL env var is missing!");

string currentEnv = Environment.GetEnvironmentVariable("APP_ENV") ?? "dev";

Console.WriteLine($"[Config] Fetching configuration from: {configUrl}");

try 
{
    using var httpClient = new HttpClient();
    var jsonString = await httpClient.GetStringAsync(configUrl);

    using var doc = JsonDocument.Parse(jsonString);
    if (doc.RootElement.TryGetProperty(currentEnv, out var envNode) && 
        envNode.TryGetProperty("model-cycle", out var cycleNode))
    {
        var config = cycleNode.Deserialize<ModelCycleConfig>();
        if (config != null)
        {
            builder.Services.AddSingleton(Microsoft.Extensions.Options.Options.Create(config));
            Console.WriteLine($"[Config] Loaded - Batch: {config.BatchSizeThreshold}, Ratio: {config.ReplayBufferRatio}");
        }
    }
    else
    {
        Console.WriteLine($"[Config] WARNING: Could not find '{currentEnv}:model-cycle' in npoint JSON.");
    }
}
catch (Exception ex)
{
    Console.WriteLine($"[Config] FATAL: Failed to load config from npoint.io. {ex.Message}");
}

builder.WebHost.UseUrls("http://0.0.0.0:3000");
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 524288000; 
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 524288000; 
});
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy => 
        policy.AllowAnyOrigin()
            .AllowAnyMethod()
            .AllowAnyHeader());
});


var dbPath = Path.Combine("/app/data", "modelcycle.db");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite($"Data Source={dbPath}"));

builder.Services.AddSingleton<IBetaDistribution, BetaDistribution>();
builder.Services.AddSingleton<IConfidenceService, ConfidenceService>();

builder.Services.AddSingleton<BlobStorageService>();

string mediaServiceUrl = builder.Configuration["MediaServiceUrl"] ?? "http://media-srv:3000";
builder.Services.AddHttpClient<IMediaService, MediaService>(client =>
{
    client.BaseAddress = new Uri(mediaServiceUrl);
});

builder.Services.AddScoped<IDatasetService, DatasetService>();

builder.Services.AddScoped<ITrainingWorkflowService, TrainingWorkflowService>();

builder.Services.AddSingleton<TrainingJobQueue>();

builder.Services.AddHostedService<QueuedTrainingWorker>();
builder.Services.AddSingleton<IBlobStorageService, BlobStorageService>();
builder.Services.AddScoped<ITrainingJobManager, TrainingJobManager>(); 
builder.Services.AddScoped<IPythonExecutor, PythonExecutor>();
builder.Services.AddScoped<IModelTrainingService, ModelTrainingService>();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Logging.AddFilter("System.Net.Http", LogLevel.Warning);

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        Directory.CreateDirectory("/app/data");
        
        var blobService = services.GetRequiredService<BlobStorageService>();
        await blobService.InitializeAsync();
        
        var context = services.GetRequiredService<AppDbContext>();
        context.Database.EnsureCreated();
        Console.WriteLine("[SQLite] Database migrated successfully.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Error] Initialization failed: {ex.Message}");
    }
}

app.UseSwagger();
app.UseSwaggerUI();

app.MapControllers();

app.MapGet("/healthz", () => Results.Json(new { status = "ok" }));

app.MapGet("/", (HttpContext ctx) =>
{
    app.Logger.LogInformation("Handling / from {remoteIp}", ctx.Connection.RemoteIpAddress?.ToString());
    return Results.Json(new
    {
        service = "model-cycle",
        message = "hello from C# service",
        env = new
        {
            hostname = Environment.MachineName,
            pod = Environment.GetEnvironmentVariable("HOSTNAME")
        }
    });
});

app.Run();