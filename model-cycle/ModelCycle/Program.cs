using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ModelCycle.Services.ImageConfidence;


var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<IBetaDistribution, BetaDistribution>();
builder.Services.AddSingleton<IConfidenceService, ConfidenceService>();

builder.Services.AddControllers();

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Logging.ClearProviders();
builder.Logging.AddConsole();

builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Logging.AddFilter("System.Net.Http", LogLevel.Warning);

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.MapControllers();

app.MapGet("/healthz", () => Results.Json(new { status = "ok" }));

app.MapGet("/", (HttpContext ctx) =>
{
    app.Logger.LogInformation(
        "Handling / from {remoteIp}",
        ctx.Connection.RemoteIpAddress?.ToString()
    );

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
