using Minio;
using Minio.DataModel.Args;
using Minio.Exceptions;           

namespace ModelCycle.Services;

public class BlobStorageService
{
    private readonly IMinioClient _minioClient;
    private readonly string _bucketName;
    private readonly ILogger<BlobStorageService> _logger;

    public BlobStorageService(IConfiguration configuration, ILogger<BlobStorageService> logger)
    {
        _logger = logger;
        _bucketName = configuration["MINIO_BUCKET_NAME"] ?? "model-cycle-storage";

        string endpoint = configuration["S3_ENDPOINT"] ?? "minio:9000"; 
        if (endpoint.StartsWith("http://")) endpoint = endpoint.Substring(7);
        if (endpoint.StartsWith("https://")) endpoint = endpoint.Substring(8);

        _minioClient = new MinioClient()
            .WithEndpoint(endpoint)
            .WithCredentials(configuration["AWS_ACCESS_KEY_ID"], configuration["AWS_SECRET_ACCESS_KEY"])
            .WithSSL(false)
            .Build();
    }
    
    public async Task InitializeAsync()
    {
        try 
        {
            var existsArgs = new BucketExistsArgs().WithBucket(_bucketName);
            bool found = await _minioClient.BucketExistsAsync(existsArgs);
                
            if (!found)
            {
                _logger.LogInformation("[MinIO] Bucket '{Bucket}' does not exist. Creating...", _bucketName);
                var makeArgs = new MakeBucketArgs().WithBucket(_bucketName);
                await _minioClient.MakeBucketAsync(makeArgs);
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

            await _minioClient.PutObjectAsync(putArgs);
            
            _logger.LogInformation("[MinIO] Successfully uploaded '{Object}' to bucket '{Bucket}'", objectName, _bucketName);
            
            return objectName; 
        }
        catch (Exception e)
        {
            _logger.LogError(e, "[MinIO] Failed to upload '{Object}' to bucket '{Bucket}'", objectName, _bucketName);
            throw;
        }
    }
}