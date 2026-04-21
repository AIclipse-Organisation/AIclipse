using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.EntityFrameworkCore;
using ModelCycle;
using ModelCycle.Data;
using ModelCycle.Repositories;
using ModelCycle.Security;
using ModelCycle.Services.ImageConfidence;
using ModelCycle.Services.Data;
using ModelCycle.Services.Training;
using ModelCycle.Services;

var builder = WebApplication.CreateBuilder(args);

var authUri = Environment.GetEnvironmentVariable("AUTH_URI");
var detectorUri = Environment.GetEnvironmentVariable("DETECTOR_URI");


builder.Services.AddHttpClient<IDetectorClientService, DetectorClientService>((serviceProvider, client) =>
{
    if (!Uri.TryCreate(detectorUri, UriKind.Absolute, out var baseUri) ||
           (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
    {
        throw new Exception($"Invalid detectorUri scheme. Expected http/https but got: {detectorUri}");
    }

    client.BaseAddress = baseUri;
    client.Timeout = TimeSpan.FromSeconds(30);
});

builder.Services.AddHttpClient<IAuthService, AuthService>(client =>
{
    if (!Uri.TryCreate(authUri, UriKind.Absolute, out var baseUri) ||
        (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
    {
        throw new Exception($"Invalid AUTH_URI scheme. Expected http/https but got: {authUri}");
    }

    client.BaseAddress = baseUri;
});

string configUrl = Environment.GetEnvironmentVariable("CENTRAL_CONFIG_URL")
                   ?? throw new Exception("CENTRAL_CONFIG_URL env var is missing!");

string currentEnv = "dev";

#if RELEASE
    currentEnv = "prod";
#elif DEBUG
currentEnv = "dev";
#endif

Console.WriteLine($"[Mode] Running in {currentEnv} mode (Build: #if RELEASE ? Prod : Dev)");

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
    options.Limits.MaxRequestBodySize = 786432000;
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 786432000;
});
var dbPath = Path.Join("/app/data", "modelcycle.db");
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite($"Data Source={dbPath}"));

builder.Services.AddScoped<IModelDeploymentService, ModelDeploymentService>();
builder.Services.AddSingleton<IBetaDistribution, BetaDistribution>();
builder.Services.AddSingleton<IConfidenceService, ConfidenceService>();
builder.Services.AddSingleton<IInternalRequestAuthorizer, InternalRequestAuthorizer>();
builder.Services.AddDataProtection();

builder.Services.AddScoped<IDatasetService, DatasetService>();

builder.Services.AddScoped<ITrainingWorkflowService, TrainingWorkflowService>();
builder.Services.AddScoped<IModelWeightsRepository, ModelWeightsRepository>();

builder.Services.AddSingleton<TrainingJobQueue>();

builder.Services.AddHostedService<QueuedTrainingWorker>();
builder.Services.AddSingleton<IBlobStorageService, BlobStorageService>();
builder.Services.AddScoped<ITrainingJobManager, TrainingJobManager>();
builder.Services.AddScoped<IPythonExecutor, PythonExecutor>();
builder.Services.AddScoped<IModelTrainingService, ModelTrainingService>();
builder.Services.AddMemoryCache();

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

        var blobService = services.GetRequiredService<IBlobStorageService>();
        await blobService.InitializeAsync();

        var context = services.GetRequiredService<AppDbContext>();
        context.Database.EnsureCreated();
        Console.WriteLine("[SQLite] Database migrated successfully.");

        var modelWeightsRepository = services.GetRequiredService<IModelWeightsRepository>();
        var v1Weights = await modelWeightsRepository.GetByVersionAsync("v1.0.0");

        if (v1Weights == null)
        {
            Console.WriteLine("[Seed] No v1.0.0 model weights found. Seeding default weights.");
            var newWeights = new ModelCycle.Models.ModelWeights
            {
                Id = Guid.NewGuid(),
                Version = "v1.0.0",
                MinioObjectPath = "seed_model/v1.0.0.pt",
                CreatedAt = DateTime.UtcNow,
                NewImagesCount = 0,
                ReplayBufferCount = 0,
                ValidationAccuracy = 0.5,
                ValidationPrecision = 0.5,
                ValidationRecall = 0.5,
                ValidationF1Score = 0.5,
                GoldenTestAccuracy = 0.5,
                GoldenTestPrecision = 0.5,
                GoldenTestRecall = 0.5,
                GoldenTestF1Score = 0.5,
                GoldenFakeToRealMisclassifications = 0,
                GoldenRealToFakeMisclassifications = 0,
                IsDeployed = false,
            };
            context.ModelWeights.Add(newWeights);
            await context.SaveChangesAsync();
            Console.WriteLine("[Seed] Default v1.0.0 model weights seeded.");
        }
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