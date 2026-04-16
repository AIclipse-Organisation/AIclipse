using Minio;
using Minio.DataModel.Args;
using Minio.Exceptions;

namespace ModelCycle.Services;

public class BlobStorageService : IBlobStorageService
{
    private readonly IMinioClient _internalMinioClient;
    private readonly IMinioClient _publicMinioClient;
    private readonly string _bucketName;
    private readonly ILogger<BlobStorageService> _logger;

    public BlobStorageService(IConfiguration configuration, ILogger<BlobStorageService> logger)
    {
        _logger = logger;
        _bucketName = configuration["MINIO_BUCKET_NAME"] ?? "model-cycle-storage";
        var accessKey = configuration["AWS_ACCESS_KEY_ID"]
                        ?? throw new InvalidOperationException("AWS_ACCESS_KEY_ID is required");
        var secretKey = configuration["AWS_SECRET_ACCESS_KEY"]
                        ?? throw new InvalidOperationException("AWS_SECRET_ACCESS_KEY is required");

        _internalMinioClient = BuildClient(configuration["S3_ENDPOINT"] ?? "s3-srv:9000", accessKey, secretKey);
        _publicMinioClient = BuildClient(
            configuration["S3_PUBLIC_ENDPOINT"] ?? throw new InvalidOperationException("S3_PUBLIC_ENDPOINT is required"),
            accessKey,
            secretKey
        );
    }

    private static IMinioClient BuildClient(string rawEndpoint, string accessKey, string secretKey)
    {
        var endpointValue = string.IsNullOrWhiteSpace(rawEndpoint) ? throw new InvalidOperationException("S3 endpoint is required") : rawEndpoint.Trim();
        if (!endpointValue.Contains("://", StringComparison.Ordinal))
        {
            endpointValue = $"http://{endpointValue}";
        }

        if (!Uri.TryCreate(endpointValue, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException($"Invalid S3 endpoint: {rawEndpoint}");
        }

        var endpoint = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";

        return new MinioClient()
            .WithEndpoint(endpoint)
            .WithCredentials(accessKey, secretKey)
            .WithSSL(uri.Scheme == Uri.UriSchemeHttps)
            .Build();
    }

    public async Task InitializeAsync()
    {
        try
        {
            var existsArgs = new BucketExistsArgs().WithBucket(_bucketName);
            bool found = await _internalMinioClient.BucketExistsAsync(existsArgs);

            if (!found)
            {
                _logger.LogInformation("[MinIO] Bucket '{Bucket}' does not exist. Creating...", _bucketName);
                var makeArgs = new MakeBucketArgs().WithBucket(_bucketName);
                await _internalMinioClient.MakeBucketAsync(makeArgs);
                _logger.LogInformation("[MinIO] Bucket '{Bucket}' created successfully.", _bucketName);
            }
            else
            {
                _logger.LogInformation("[MinIO] Bucket '{Bucket}' already exists.", _bucketName);
            }
        }
        catch (MinioException e)
        {
            _logger.LogCritical(e, "[MinIO] Failed to initialize bucket '{Bucket}'. Check connection or credentials.", _bucketName);
            throw; 
        }
        catch (Exception e)
        {
            _logger.LogCritical(e, "[MinIO] Unexpected error during initialization.");
            throw;
        }
    }

    public async Task<string> UploadFileAsync(Stream fileStream, string folder, string fileName, string contentType)
    {
        string objectName = $"{folder}/{fileName}";

        try
        {
            var putArgs = new PutObjectArgs()
                .WithBucket(_bucketName)
                .WithObject(objectName)
                .WithStreamData(fileStream)
                .WithObjectSize(fileStream.Length)
                .WithContentType(contentType);

            await _internalMinioClient.PutObjectAsync(putArgs);

            _logger.LogInformation("[MinIO] Successfully uploaded to bucket '{Bucket}'", _bucketName);

            return objectName;
        }
        catch (Exception e)
        {
            _logger.LogError(e, "[MinIO] Failed to upload  to bucket '{Bucket}'", _bucketName);
            throw;
        }
    }

    public async Task<string> CreatePresignedUploadUrlAsync(string objectName, int expiresSeconds)
    {
        var args = new PresignedPutObjectArgs()
            .WithBucket(_bucketName)
            .WithObject(objectName)
            .WithExpiry(expiresSeconds);

        return await _publicMinioClient.PresignedPutObjectAsync(args);
    }

    public async Task CopyObjectAsync(string sourceObjectName, string destinationObjectName, string? bucketName = null)
    {
        var targetBucket = bucketName ?? _bucketName;
        var source = new CopySourceObjectArgs()
            .WithBucket(targetBucket)
            .WithObject(sourceObjectName);

        var args = new CopyObjectArgs()
            .WithBucket(targetBucket)
            .WithObject(destinationObjectName)
            .WithCopyObjectSource(source);

        await _internalMinioClient.CopyObjectAsync(args);
    }

    public async Task<int> DeleteObjectsOlderThanAsync(string prefix, DateTime olderThanUtc, string? bucketName = null)
    {
        var targetBucket = bucketName ?? _bucketName;
        var deletedCount = 0;
        var args = new ListObjectsArgs()
            .WithBucket(targetBucket)
            .WithPrefix(prefix)
            .WithRecursive(true);

        await foreach (var item in _internalMinioClient.ListObjectsEnumAsync(args))
        {
            if (item.IsDir || string.IsNullOrWhiteSpace(item.Key))
            {
                continue;
            }

            var lastModifiedUtc = item.LastModifiedDateTime?.ToUniversalTime();
            if (lastModifiedUtc == null || lastModifiedUtc > olderThanUtc)
            {
                continue;
            }

            var deleteArgs = new RemoveObjectArgs()
                .WithBucket(targetBucket)
                .WithObject(item.Key);

            await _internalMinioClient.RemoveObjectAsync(deleteArgs);
            deletedCount++;
        }

        return deletedCount;
    }

    public async Task<BlobObjectInfo?> StatObjectAsync(string objectName, string? bucketName = null)
    {
        var targetBucket = bucketName ?? _bucketName;
        try
        {
            var args = new StatObjectArgs()
                .WithBucket(targetBucket)
                .WithObject(objectName);

            var stat = await _internalMinioClient.StatObjectAsync(args);
            return new BlobObjectInfo(objectName, stat.Size);
        }
        catch (ObjectNotFoundException)
        {
            return null;
        }
    }

    public async Task DownloadFileAsync(string s3Key, string destinationPath, string? bucketName = null)
    {
        string targetBucket = bucketName ?? _bucketName;

        try
        {
            var directory = Path.GetDirectoryName(destinationPath);

            if (!Directory.Exists(directory) && !string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            var args = new GetObjectArgs()
                .WithBucket(targetBucket)
                .WithObject(s3Key)
                .WithCallbackStream((stream) =>
                {
                    using (var fileStream = new FileStream(destinationPath, FileMode.Create, FileAccess.Write))
                    {
                        stream.CopyTo(fileStream);
                    }
                });

            await _internalMinioClient.GetObjectAsync(args);

            _logger.LogInformation("[MinIO] Successfully downloaded '{Key}' from bucket '{Bucket}'", s3Key, targetBucket);
        }
        catch (Exception e)
        {
            _logger.LogError(e, "[MinIO] Failed to download '{Key}' from bucket '{Bucket}'", s3Key, targetBucket);

            if (File.Exists(destinationPath)) File.Delete(destinationPath);
            throw;
        }
    }

    public async Task DeleteFileAsync(string objectName, string? bucketName = null)
    {
        var targetBucket = bucketName ?? _bucketName;
        var args = new RemoveObjectArgs()
            .WithBucket(targetBucket)
            .WithObject(objectName);

        await _internalMinioClient.RemoveObjectAsync(args);
    }
}