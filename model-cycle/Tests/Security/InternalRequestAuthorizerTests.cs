using System;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ModelCycle.Security;
using Xunit;

namespace ModelCycle.Tests.Security;

public class InternalRequestAuthorizerTests
{
    [Fact]
    public void RequireForwardedAdmin_AcceptsTrustedAdminHeaders()
    {
        Environment.SetEnvironmentVariable("INTERNAL_AUTH_TOKEN", "test-internal-token");
        var authorizer = new InternalRequestAuthorizer();
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Internal-Token"] = "test-internal-token";
        context.Request.Headers["X-User-Id"] = "u_admin";
        context.Request.Headers["X-User-Is-Admin"] = "true";

        var result = authorizer.RequireForwardedAdmin(context.Request);

        Assert.Null(result);
    }

    [Fact]
    public void RequireForwardedAdmin_RejectsMissingForwardedUser()
    {
        Environment.SetEnvironmentVariable("INTERNAL_AUTH_TOKEN", "test-internal-token");
        var authorizer = new InternalRequestAuthorizer();
        var context = new DefaultHttpContext();
        context.Request.Headers["X-Internal-Token"] = "test-internal-token";

        var result = authorizer.RequireForwardedAdmin(context.Request);

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Equal(401, unauthorized.StatusCode);
    }
}
