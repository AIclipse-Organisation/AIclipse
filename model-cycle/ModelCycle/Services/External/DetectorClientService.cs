public class DetectorClientService : IDetectorClientService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<DetectorClientService> _logger;

    public DetectorClientService(HttpClient httpClient, ILogger<DetectorClientService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
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

            var response = await _httpClient.PostAsJsonAsync("/internal/reload-model", payload);

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