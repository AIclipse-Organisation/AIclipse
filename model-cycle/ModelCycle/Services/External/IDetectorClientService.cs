public interface IDetectorClientService
{
    Task<bool> NotifyModelUpdateAsync(string version, string minioPath);
}