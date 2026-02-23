public class AuthService : IAuthService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<AuthService> _logger;

    public AuthService(HttpClient httpClient, ILogger<AuthService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<List<UserAccuracy>> GetUsersAccuracyAsync(List<string> userIds)
    {
        if (userIds == null || !userIds.Any()) return new List<UserAccuracy>();

        try
        {
            var response = await _httpClient.PostAsJsonAsync("admin/users/accuracy", new { user_ids = userIds });
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