public class DetectorClientService : IDetectorClientService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<DetectorClientService> _logger;
    private readonly string _internalAuthToken;

    public DetectorClientService(HttpClient httpClient, ILogger<DetectorClientService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _internalAuthToken = Environment.GetEnvironmentVariable("INTERNAL_AUTH_TOKEN") ?? "";
    }

    public async Task<bool> NotifyModelUpdateAsync(string version, string minioPath)
    {
        try
        {
            var payload = new
            {
                version = version,
                minio_path = minioPath
            };

            _logger.LogInformation("Notifying Detector to hot-swap to version {Version} at {Path}", version, minioPath);

            using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/reload-model")
            {
                Content = JsonContent.Create(payload)
            };
            request.Headers.Add("X-Internal-Token", _internalAuthToken);

            var response = await _httpClient.SendAsync(request);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("Detector successfully acknowledged model version {Version}.", version);
                return true;
            }

            _logger.LogWarning("Detector reload failed. Status Code: {StatusCode}. Version: {Version}",
                response.StatusCode, version);

            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Network error while reaching Detector service for version {Version}.", version);
            return false;
        }
    }
}