public interface IAuthService
{
    Task<List<UserAccuracy>> GetUsersAccuracyAsync(List<string> userIds);
}