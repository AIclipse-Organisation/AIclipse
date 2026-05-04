namespace ModelCycle.Services;

public sealed class ModelUploadException : Exception
{
    public ModelUploadException(int statusCode, string message) : base(message)
    {
        StatusCode = statusCode;
    }

    public int StatusCode { get; }
}
