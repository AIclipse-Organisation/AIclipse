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
    private const int MultipartPartSizeBytes = 16 * 1024 * 1024;
    private const string UploadCleanupCacheKey = "model-cycle.staging-upload-cleanup";
    private const string StagingDirectoryName = "admin-upload-staging";
    private const string StagingMarkerFileName = ".upload-session";
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
    private readonly string _stagingRootPath;

    public ModelDeploymentService(
        AppDbContext dbContext,
        IBlobStorageService blobService,
        IDetectorClientService detectorClient,
        IMemoryCache memoryCache,
        IDataProtectionProvider dataProtectionProvider,
        IConfiguration configuration,
        ILogger<ModelDeploymentService> logger)
    {
        _dbContext = dbContext;
        _blobService = blobService;
        _detectorClient = detectorClient;
        _logger = logger;
        _memoryCache = memoryCache;
        _uploadProtector = dataProtectionProvider.CreateProtector("model-cycle.admin-upload-session.v1");
        _stagingRootPath = ResolveStagingRootPath(configuration);
        Directory.CreateDirectory(_stagingRootPath);
    }

    public async Task<CreateModelUploadSessionResponse> CreateUploadSessionAsync(CreateModelUploadSessionRequest request)
    {
        var normalizedVersion = NormalizeVersion(request.Version);
        await EnsureVersionAvailableAsync(normalizedVersion);

        if (request.FileSize <= 0 || request.FileSize > MaxUploadBytes)
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Model file size must be between 1 byte and 750 MB.");
        }

        var fileExtension = NormalizeExtension(request.FileName);
        var contentType = NormalizeContentType(request.ContentType);
        await CleanupExpiredStagingUploadsBestEffortAsync();

        var stagingId = Guid.NewGuid().ToString("N");
        var expiresAt = DateTime.UtcNow.AddSeconds(UploadSessionTtlSeconds);
        var totalParts = CalculateTotalParts(request.FileSize);
        var payload = new UploadSessionPayload
        {
            StagingId = stagingId,
            Version = normalizedVersion,
            FileExtension = fileExtension,
            FileSize = request.FileSize,
            ContentType = contentType,
            PartSizeBytes = MultipartPartSizeBytes,
            TotalParts = totalParts,
            ExpiresAt = expiresAt,
        };

        CreateStagingLayout(payload);
        var uploadId = _uploadProtector.Protect(JsonSerializer.Serialize(payload));

        return new CreateModelUploadSessionResponse
        {
            UploadId = uploadId,
            UploadMethod = "PUT",
            PartSizeBytes = MultipartPartSizeBytes,
            TotalParts = totalParts,
            ExpiresAt = expiresAt,
        };
    }

    public async Task<UploadModelPartResponse> UploadPartAsync(
        string uploadId,
        int partNumber,
        Stream partStream,
        long? contentLength,
        string? contentType)
    {
        var upload = UnprotectUploadSession(uploadId);
        ValidatePartUploadRequest(upload, partNumber, contentLength);

        var expectedContentType = upload.ContentType;
        if (!string.IsNullOrWhiteSpace(contentType) &&
            !string.Equals(contentType.Trim(), expectedContentType, StringComparison.OrdinalIgnoreCase))
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Upload part content type does not match the upload session.");
        }

        var stagingFilePath = GetStagingFilePath(upload);
        Directory.CreateDirectory(GetStagingDirectory(upload));

        var expectedOffset = GetPartStartOffset(upload, partNumber);
        var expectedEndOffset = expectedOffset + contentLength!.Value;

        await using (var fileStream = new FileStream(stagingFilePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
        {
            if (fileStream.Length == expectedEndOffset)
            {
                TouchStagingMarker(upload);
                return new UploadModelPartResponse { PartNumber = partNumber };
            }

            if (fileStream.Length != expectedOffset)
            {
                throw new ModelUploadException(StatusCodes.Status409Conflict, "Upload parts must be sent in order for the active upload session.");
            }

            fileStream.Position = expectedOffset;
            await partStream.CopyToAsync(fileStream);
            await fileStream.FlushAsync();

            if (fileStream.Length != expectedEndOffset)
            {
                throw new ModelUploadException(StatusCodes.Status409Conflict, "Uploaded part size does not match the approved upload session.");
            }
        }

        TouchStagingMarker(upload);
        return new UploadModelPartResponse { PartNumber = partNumber };
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

        var stagingFilePath = GetStagingFilePath(upload);
        if (!File.Exists(stagingFilePath))
        {
            throw new ModelUploadException(StatusCodes.Status409Conflict, "Uploaded model was not found. Re-upload the file and finalize again.");
        }

        var canonicalFileName = $"{normalizedVersion}{upload.FileExtension}";
        var canonicalObjectName = $"models/{canonicalFileName}";
        await EnsureCanonicalObjectAvailableAsync(canonicalObjectName);
        string storedObjectPath;
        await using (var stagedStream = new FileStream(stagingFilePath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (stagedStream.Length != upload.FileSize)
            {
                throw new ModelUploadException(StatusCodes.Status409Conflict, "Uploaded model size does not match the approved upload session.");
            }

            storedObjectPath = await _blobService.UploadFileAsync(stagedStream, "models", canonicalFileName, upload.ContentType);
        }

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
        ModelWeights deployed;
        try
        {
            deployed = await ActivateStoredModelAsync(storedObjectPath, modelWeight, links);
        }
        catch (ModelUploadException)
        {
            await RollbackUploadedObjectBestEffortAsync(storedObjectPath);
            throw;
        }
        catch (Exception ex)
        {
            await RollbackUploadedObjectBestEffortAsync(storedObjectPath);
            _logger.LogError(
                ex,
                "Failed to persist uploaded model version {Version} after storing object {ObjectPath}.",
                normalizedVersion,
                storedObjectPath
            );
            throw new ModelUploadException(
                StatusCodes.Status500InternalServerError,
                "Failed to persist uploaded model metadata after storing the model file."
            );
        }

        TryDeleteStagingDirectory(upload);
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
            var deletedCount = DeleteStagingDirectoriesOlderThan(olderThanUtc);
            _memoryCache.Set(UploadCleanupCacheKey, true, UploadCleanupCadence);

            if (deletedCount > 0)
            {
                _logger.LogInformation(
                    "Deleted {DeletedCount} expired staged model upload directories older than {OlderThanUtc}.",
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

    private void CreateStagingLayout(UploadSessionPayload upload)
    {
        var stagingDirectory = GetStagingDirectory(upload);
        if (Directory.Exists(stagingDirectory))
        {
            Directory.Delete(stagingDirectory, recursive: true);
        }

        Directory.CreateDirectory(stagingDirectory);
        TouchStagingMarker(upload);
    }

    private void TouchStagingMarker(UploadSessionPayload upload)
    {
        var markerPath = GetStagingMarkerPath(upload);
        if (!File.Exists(markerPath))
        {
            File.WriteAllText(markerPath, string.Empty);
        }

        File.SetLastWriteTimeUtc(markerPath, DateTime.UtcNow);
    }

    private int DeleteStagingDirectoriesOlderThan(DateTime olderThanUtc)
    {
        if (!Directory.Exists(_stagingRootPath))
        {
            return 0;
        }

        var deletedCount = 0;
        foreach (var directory in Directory.EnumerateDirectories(_stagingRootPath))
        {
            var markerPath = Path.Combine(directory, StagingMarkerFileName);
            var lastTouchedUtc = File.Exists(markerPath)
                ? File.GetLastWriteTimeUtc(markerPath)
                : Directory.GetLastWriteTimeUtc(directory);

            if (lastTouchedUtc > olderThanUtc)
            {
                continue;
            }

            Directory.Delete(directory, recursive: true);
            deletedCount++;
        }

        return deletedCount;
    }

    private void TryDeleteStagingDirectory(UploadSessionPayload upload)
    {
        var stagingDirectory = GetStagingDirectory(upload);
        if (!Directory.Exists(stagingDirectory))
        {
            return;
        }

        try
        {
            Directory.Delete(stagingDirectory, recursive: true);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Failed to delete staged upload directory {StagingDirectory} after successful model finalize.",
                stagingDirectory
            );
        }
    }

    private async Task RollbackUploadedObjectBestEffortAsync(string objectPath)
    {
        if (string.IsNullOrWhiteSpace(objectPath))
        {
            return;
        }

        try
        {
            await _blobService.DeleteFileAsync(objectPath);
            _logger.LogWarning(
                "Rolled back uploaded model object {ObjectPath} after finalize failed before persistence.",
                objectPath
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Failed to roll back uploaded model object {ObjectPath} after finalize failure.",
                objectPath
            );
        }
    }

    private string GetStagingDirectory(UploadSessionPayload upload)
    {
        return Path.Combine(_stagingRootPath, upload.StagingId);
    }

    private string GetStagingFilePath(UploadSessionPayload upload)
    {
        return Path.Combine(GetStagingDirectory(upload), $"model{upload.FileExtension}");
    }

    private string GetStagingMarkerPath(UploadSessionPayload upload)
    {
        return Path.Combine(GetStagingDirectory(upload), StagingMarkerFileName);
    }

    private static void ValidatePartUploadRequest(UploadSessionPayload upload, int partNumber, long? contentLength)
    {
        if (partNumber < 1 || partNumber > upload.TotalParts)
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Upload part number is outside the approved upload session.");
        }

        if (!contentLength.HasValue || contentLength.Value <= 0)
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Upload part size is required.");
        }

        var expectedPartSize = ExpectedPartSize(upload, partNumber);
        if (contentLength.Value != expectedPartSize)
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Upload part size does not match the approved upload session.");
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

    private static string ResolveStagingRootPath(IConfiguration configuration)
    {
        var trainingDataPath = configuration["TRAINING_DATA_PATH"];
        if (!string.IsNullOrWhiteSpace(trainingDataPath))
        {
            return Path.Combine(trainingDataPath, StagingDirectoryName);
        }

        return Path.Combine(Path.GetTempPath(), StagingDirectoryName);
    }

    private static int CalculateTotalParts(long fileSize)
    {
        var totalParts = checked((int)((fileSize + MultipartPartSizeBytes - 1) / MultipartPartSizeBytes));
        if (totalParts <= 0)
        {
            throw new ModelUploadException(StatusCodes.Status400BadRequest, "Model upload must contain at least one part.");
        }

        return totalParts;
    }

    private static long ExpectedPartSize(UploadSessionPayload upload, int partNumber)
    {
        if (partNumber < upload.TotalParts)
        {
            return upload.PartSizeBytes;
        }

        return upload.FileSize - GetPartStartOffset(upload, partNumber);
    }

    private static long GetPartStartOffset(UploadSessionPayload upload, int partNumber)
    {
        return (long)(partNumber - 1) * upload.PartSizeBytes;
    }

    private sealed class UploadSessionPayload
    {
        public string StagingId { get; set; } = string.Empty;
        public string Version { get; set; } = string.Empty;
        public string FileExtension { get; set; } = string.Empty;
        public long FileSize { get; set; }
        public string ContentType { get; set; } = "application/octet-stream";
        public int PartSizeBytes { get; set; }
        public int TotalParts { get; set; }
        public DateTime ExpiresAt { get; set; }
    }
}
