using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using ModelCycle.Data;
using ModelCycle.DTOs;
using ModelCycle.Models;

namespace ModelCycle.Services;

public class ModelDeploymentService : IModelDeploymentService
{
    private const int UploadSessionTtlSeconds = 3600;
    private const long MaxUploadBytes = 786432000;
    private const string StagingUploadPrefix = "models/uploads/";
    private const string UploadCleanupCacheKey = "model-cycle.staging-upload-cleanup";
    private static readonly TimeSpan UploadCleanupCadence = TimeSpan.FromMinutes(10);
    private static readonly SemaphoreSlim UploadCleanupGate = new(1, 1);
    private static readonly Regex VersionPattern = new("^[A-Za-z0-9._-]{1,64}$", RegexOptions.Compiled);
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pt",
        ".bin",
        ".safetensors",
    };

    private readonly AppDbContext _dbContext;
    private readonly IBlobStorageService _blobService;
    private readonly IDetectorClientService _detectorClient;
    private readonly ILogger<ModelDeploymentService> _logger;
    private readonly IMemoryCache _memoryCache;
    private readonly IDataProtector _uploadProtector;

    public ModelDeploymentService(
        AppDbContext dbContext,
        IBlobStorageService blobService,
        IDetectorClientService detectorClient,
        IMemoryCache memoryCache,
        IDataProtectionProvider dataProtectionProvider,
        ILogger<ModelDeploymentService> logger)
    {
        _dbContext = dbContext;
        _blobService = blobService;
        _detectorClient = detectorClient;
        _logger = logger;
        _memoryCache = memoryCache;
        _uploadProtector = dataProtectionProvider.CreateProtector("model-cycle.admin-upload-session.v1");
    }

    public async Task<CreateModelUploadSessionResponse> CreateUploadSessionAsync(
        CreateModelUploadSessionRequest request,
        string? externalProto = null)
    {
        var normalizedVersion = NormalizeVersion(request.Version);
        await EnsureVersionAvailableAsync(normalizedVersion);

        if (request.FileSize <= 0 || request.FileSize > MaxUploadBytes)
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Model file size must be between 1 byte and 750 MB.");
        }

        var extension = NormalizeExtension(request.FileName);
        var contentType = NormalizeContentType(request.ContentType);
        await CleanupExpiredStagingUploadsBestEffortAsync();
        var objectName = $"models/uploads/{Guid.NewGuid():N}/{normalizedVersion}{extension}";
        var expiresAt = DateTime.UtcNow.AddSeconds(UploadSessionTtlSeconds);

        var payload = new UploadSessionPayload
        {
            ObjectName = objectName,
            Version = normalizedVersion,
            FileSize = request.FileSize,
            ContentType = contentType,
            ExpiresAt = expiresAt,
        };

        var uploadId = _uploadProtector.Protect(JsonSerializer.Serialize(payload));
        var uploadUrl = await _blobService.CreatePresignedUploadUrlAsync(
            objectName,
            UploadSessionTtlSeconds,
            externalProto
        );

        return new CreateModelUploadSessionResponse
        {
            UploadId = uploadId,
            UploadUrl = uploadUrl,
            UploadMethod = "PUT",
            UploadHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["Content-Type"] = contentType,
            },
            ExpiresAt = expiresAt,
        };
    }

    public async Task<ModelWeights> FinalizeUploadedModelAsync(FinalizeModelUploadRequest request)
    {
        var normalizedVersion = NormalizeVersion(request.Version);
        var upload = UnprotectUploadSession(request.UploadId);

        if (!string.Equals(upload.Version, normalizedVersion, StringComparison.Ordinal))
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Upload session version does not match the finalize request.");
        }

        await EnsureVersionAvailableAsync(normalizedVersion);

        var stat = await _blobService.StatObjectAsync(upload.ObjectName);
        if (stat == null)
        {
            throw new ModelUploadException(StatusCodes.Status409Conflict, "Uploaded model was not found. Re-upload the file and finalize again.");
        }

        if (stat.Size != upload.FileSize)
        {
            throw new ModelUploadException(StatusCodes.Status409Conflict, "Uploaded model size does not match the approved upload session.");
        }

        var extension = Path.GetExtension(upload.ObjectName);
        var canonicalObjectName = $"models/{normalizedVersion}{extension}";
        await EnsureCanonicalObjectAvailableAsync(canonicalObjectName);
        await _blobService.CopyObjectAsync(upload.ObjectName, canonicalObjectName);

        var modelId = Guid.NewGuid();
        var modelWeight = new ModelWeights
        {
            Id = modelId,
            Version = normalizedVersion,
            NewImagesCount = request.NewImagesCount,
            ReplayBufferCount = request.ReplayBufferCount,
            ValidationAccuracy = request.ValidationAccuracy,
            ValidationPrecision = request.ValidationPrecision,
            ValidationRecall = request.ValidationRecall,
            ValidationF1Score = request.ValidationF1Score,
            GoldenTestAccuracy = request.GoldenTestAccuracy,
            GoldenTestPrecision = request.GoldenTestPrecision,
            GoldenTestRecall = request.GoldenTestRecall,
            GoldenTestF1Score = request.GoldenTestF1Score,
            GoldenFakeToRealMisclassifications = request.GoldenFakeToRealMisclassifications,
            GoldenRealToFakeMisclassifications = request.GoldenRealToFakeMisclassifications,
        };

        var links = BuildImageLinks(modelId, request);
        var deployed = await ActivateStoredModelAsync(canonicalObjectName, modelWeight, links);

        try
        {
            await _blobService.DeleteFileAsync(upload.ObjectName);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to delete staged upload object {ObjectName} after promotion.", upload.ObjectName);
        }

        return deployed;
    }

    public async Task<ModelWeights> UploadAndDeployModelAsync(
        Stream modelStream,
        string fileName,
        string contentType,
        ModelWeights newModelWeights,
        List<ModelImageLink> imageLinks)
    {
        _logger.LogInformation("Uploading model {FileName} to MinIO...", fileName);
        var minioPath = await _blobService.UploadFileAsync(modelStream, "models", fileName, contentType);
        return await ActivateStoredModelAsync(minioPath, newModelWeights, imageLinks);
    }

    private async Task<ModelWeights> ActivateStoredModelAsync(
        string objectPath,
        ModelWeights newModelWeights,
        List<ModelImageLink> imageLinks)
    {
        newModelWeights.MinioObjectPath = objectPath;
        newModelWeights.IsDeployed = true;
        newModelWeights.CreatedAt = DateTime.UtcNow;
        newModelWeights.ImageLinks = imageLinks;

        var currentlyDeployed = await _dbContext.ModelWeights
            .Where(m => m.IsDeployed)
            .ToListAsync();

        foreach (var model in currentlyDeployed)
        {
            model.IsDeployed = false;
        }

        _dbContext.ModelWeights.Add(newModelWeights);
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Notifying Detector of new model version {Version}...", newModelWeights.Version);
        await _detectorClient.NotifyModelUpdateAsync(newModelWeights.Version, objectPath);

        return newModelWeights;
    }

    private async Task EnsureVersionAvailableAsync(string version)
    {
        var exists = await _dbContext.ModelWeights.AnyAsync(m => m.Version == version);
        if (exists)
        {
            throw new ModelUploadException(StatusCodes.Status409Conflict, $"Model version '{version}' already exists.");
        }
    }

    private async Task EnsureCanonicalObjectAvailableAsync(string objectName)
    {
        var existingObject = await _blobService.StatObjectAsync(objectName);
        if (existingObject != null)
        {
            throw new ModelUploadException(StatusCodes.Status409Conflict, $"Canonical model object '{objectName}' already exists.");
        }
    }

    private async Task CleanupExpiredStagingUploadsBestEffortAsync()
    {
        if (_memoryCache.TryGetValue(UploadCleanupCacheKey, out _))
        {
            return;
        }

        if (!await UploadCleanupGate.WaitAsync(TimeSpan.Zero))
        {
            return;
        }

        try
        {
            if (_memoryCache.TryGetValue(UploadCleanupCacheKey, out _))
            {
                return;
            }

            var olderThanUtc = DateTime.UtcNow.AddSeconds(-UploadSessionTtlSeconds);
            var deletedCount = await _blobService.DeleteObjectsOlderThanAsync(StagingUploadPrefix, olderThanUtc);
            _memoryCache.Set(UploadCleanupCacheKey, true, UploadCleanupCadence);

            if (deletedCount > 0)
            {
                _logger.LogInformation(
                    "Deleted {DeletedCount} expired staged model uploads older than {OlderThanUtc}.",
                    deletedCount,
                    olderThanUtc
                );
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to clean expired staged model uploads.");
        }
        finally
        {
            UploadCleanupGate.Release();
        }
    }

    private UploadSessionPayload UnprotectUploadSession(string uploadId)
    {
        try
        {
            var json = _uploadProtector.Unprotect(uploadId);
            var payload = JsonSerializer.Deserialize<UploadSessionPayload>(json)
                          ?? throw new ModelUploadException(StatusCodes.Status400BadRequest, "Upload session payload is invalid.");

            if (payload.ExpiresAt <= DateTime.UtcNow)
            {
                throw new ModelUploadException(StatusCodes.Status400BadRequest, "Upload session expired. Start a new upload.");
            }

            return payload;
        }
        catch (ModelUploadException)
        {
            throw;
        }
        catch (Exception)
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Upload session is invalid.");
        }
    }

    private static List<ModelImageLink> BuildImageLinks(Guid modelId, FinalizeModelUploadRequest request)
    {
        var links = new List<ModelImageLink>();
        AddLinks(links, request.NewTrainingImageIds, modelId, ImageUsageType.NewTraining);
        AddLinks(links, request.ReplayImageIds, modelId, ImageUsageType.Replay);
        AddLinks(links, request.GoldenTestImageIds, modelId, ImageUsageType.GoldenTest);
        return links;
    }

    private static void AddLinks(List<ModelImageLink> links, IEnumerable<Guid>? ids, Guid modelId, ImageUsageType usageType)
    {
        if (ids == null)
        {
            return;
        }

        foreach (var imgId in ids)
        {
            links.Add(new ModelImageLink
            {
                ModelWeightId = modelId,
                TrainingImageId = imgId,
                UsageType = usageType,
            });
        }
    }

    private static string NormalizeVersion(string version)
    {
        if (string.IsNullOrWhiteSpace(version))
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Model version is required.");
        }

        var normalized = version.Trim();
        if (!normalized.StartsWith("v", StringComparison.OrdinalIgnoreCase))
        {
            normalized = $"v{normalized}";
        }

        if (!VersionPattern.IsMatch(normalized))
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Model version contains invalid characters.");
        }

        return normalized;
    }

    private static string NormalizeExtension(string fileName)
    {
        var extension = Path.GetExtension(fileName ?? string.Empty);
        if (string.IsNullOrWhiteSpace(extension) || !AllowedExtensions.Contains(extension))
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Supported model file extensions are .pt, .bin, and .safetensors.");
        }

        return extension.ToLowerInvariant();
    }

    private static string NormalizeContentType(string? contentType)
    {
        return string.IsNullOrWhiteSpace(contentType) ? "application/octet-stream" : contentType.Trim();
    }

    private sealed class UploadSessionPayload
    {
        public string ObjectName { get; set; } = string.Empty;
        public string Version { get; set; } = string.Empty;
        public long FileSize { get; set; }
        public string ContentType { get; set; } = "application/octet-stream";
        public DateTime ExpiresAt { get; set; }
    }
}
