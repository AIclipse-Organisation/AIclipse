using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;

namespace ModelCycle.Security;

public interface IInternalRequestAuthorizer
{
    IActionResult? RequireInternalRequest(HttpRequest request);
    IActionResult? RequireForwardedAdmin(HttpRequest request);
}

public sealed class InternalRequestAuthorizer : IInternalRequestAuthorizer
{
    private readonly string _expectedToken;

    public InternalRequestAuthorizer()
    {
        _expectedToken = Environment.GetEnvironmentVariable("INTERNAL_AUTH_TOKEN") ?? string.Empty;
    }

    public IActionResult? RequireInternalRequest(HttpRequest request)
    {
        if (string.IsNullOrWhiteSpace(_expectedToken))
        {
            return new ObjectResult(new { detail = "Internal auth not configured" }) { StatusCode = 503 };
        }

        var providedToken = request.Headers["X-Internal-Token"].ToString().Trim();
        if (!HasValidToken(providedToken))
        {
            return new UnauthorizedObjectResult(new { detail = "Invalid internal auth token" });
        }

        return null;
    }

    public IActionResult? RequireForwardedAdmin(HttpRequest request)
    {
        var internalFailure = RequireInternalRequest(request);
        if (internalFailure != null)
        {
            return internalFailure;
        }

        var userId = request.Headers["X-User-Id"].ToString().Trim();
        if (string.IsNullOrWhiteSpace(userId))
        {
            return new UnauthorizedObjectResult(new { detail = "Missing forwarded user id" });
        }

        var isAdmin = string.Equals(
            request.Headers["X-User-Is-Admin"].ToString().Trim(),
            "true",
            StringComparison.OrdinalIgnoreCase);
        if (!isAdmin)
        {
            return new ObjectResult(new { detail = "Admin privileges required" }) { StatusCode = 403 };
        }

        return null;
    }

    private bool HasValidToken(string providedToken)
    {
        if (string.IsNullOrEmpty(providedToken))
        {
            return false;
        }

        var expectedBytes = Encoding.UTF8.GetBytes(_expectedToken);
        var providedBytes = Encoding.UTF8.GetBytes(providedToken);
        return CryptographicOperations.FixedTimeEquals(expectedBytes, providedBytes);
    }
}
