    using System;
    using System.IO;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Configuration;
    using Minio;
    using Minio.DataModel.Args;

    namespace ModelCycle.Services;

    public class BlobStorageService
    {
        private readonly IMinioClient _minioClient;
        private readonly string _bucketName;

        public BlobStorageService(IConfiguration configuration)
        {
            _bucketName = configuration["MINIO_BUCKET_NAME"] ?? "model-cycle-storage";
            string endpoint = configuration["S3_ENDPOINT"];
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
            var existsArgs = new BucketExistsArgs().WithBucket(_bucketName);
            bool found = await _minioClient.BucketExistsAsync(existsArgs);
                
            if (!found)
            {
                var makeArgs = new MakeBucketArgs().WithBucket(_bucketName);
                await _minioClient.MakeBucketAsync(makeArgs);
                Console.WriteLine($"[MinIO] Bucket '{_bucketName}' created.");
            }
        }

        public async Task<string> UploadFileAsync(Stream fileStream, string folder, string fileName, string contentType)
        {
            string objectName = $"{folder}/{fileName}";

            var putArgs = new PutObjectArgs()
                .WithBucket(_bucketName)
                .WithObject(objectName)
                .WithStreamData(fileStream)
                .WithObjectSize(fileStream.Length)
                .WithContentType(contentType);

            await _minioClient.PutObjectAsync(putArgs);
                
            return objectName; 
        }
    }