using System;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ModelCycle.Security;
using Xunit;

namespace ModelCycle.Tests.Security;

[Collection(global::Tests.EnvironmentVariableCollection.Name)]
public class InternalRequestAuthorizerTests
{
    [Fact]
    public void RequireForwardedAdmin_AcceptsTrustedAdminHeaders()
    {
        var previousToken = Environment.GetEnvironmentVariable("INTERNAL_AUTH_TOKEN");
        Environment.SetEnvironmentVariable("INTERNAL_AUTH_TOKEN", "test-internal-token");

        try
        {
            var authorizer = new InternalRequestAuthorizer();
            var context = new DefaultHttpContext();
            context.Request.Headers["X-Internal-Token"] = "test-internal-token";
            context.Request.Headers["X-User-Id"] = "u_admin";
            context.Request.Headers["X-User-Is-Admin"] = "true";

            var result = authorizer.RequireForwardedAdmin(context.Request);

            Assert.Null(result);
        }
        finally
        {
            Environment.SetEnvironmentVariable("INTERNAL_AUTH_TOKEN", previousToken);
        }
    }

    [Fact]
    public void RequireForwardedAdmin_RejectsMissingForwardedUser()
    {
        var previousToken = Environment.GetEnvironmentVariable("INTERNAL_AUTH_TOKEN");
        Environment.SetEnvironmentVariable("INTERNAL_AUTH_TOKEN", "test-internal-token");

        try
        {
            var authorizer = new InternalRequestAuthorizer();
            var context = new DefaultHttpContext();
            context.Request.Headers["X-Internal-Token"] = "test-internal-token";

            var result = authorizer.RequireForwardedAdmin(context.Request);

            var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result);
            Assert.Equal(401, unauthorized.StatusCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("INTERNAL_AUTH_TOKEN", previousToken);
        }
    }
}
