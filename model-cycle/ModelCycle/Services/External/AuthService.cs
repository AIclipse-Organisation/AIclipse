public class AuthService : IAuthService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<AuthService> _logger;
    private readonly string _internalAuthToken;

    public AuthService(HttpClient httpClient, ILogger<AuthService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _internalAuthToken = Environment.GetEnvironmentVariable("INTERNAL_AUTH_TOKEN") ?? "";
    }

    public async Task<List<UserAccuracy>> GetUsersAccuracyAsync(List<string> userIds)
    {
        if (userIds == null || !userIds.Any()) return new List<UserAccuracy>();

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/internal/users/accuracy")
            {
                Content = JsonContent.Create(new { user_ids = userIds })
            };
            request.Headers.Add("X-Internal-Token", _internalAuthToken);

            var response = await _httpClient.SendAsync(request);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<List<UserAccuracy>>() ?? new List<UserAccuracy>();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching user accuracy for {Count} users", userIds.Count);
            return new List<UserAccuracy>();
        }
    }
}
