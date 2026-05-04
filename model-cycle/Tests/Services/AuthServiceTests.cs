using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using ModelCycle.Services;
using Xunit;

namespace Tests.Services;

[Collection(global::Tests.EnvironmentVariableCollection.Name)]
public sealed class AuthServiceTests
{
    [Fact]
    public async Task GetUsersAccuracyAsync_UsesInternalAccuracyEndpointAndToken()
    {
        var previousToken = Environment.GetEnvironmentVariable("INTERNAL_AUTH_TOKEN");
        Environment.SetEnvironmentVariable("INTERNAL_AUTH_TOKEN", "internal-test-token");

        try
        {
            var handler = new StubHttpMessageHandler(async request =>
            {
                Assert.Equal(HttpMethod.Post, request.Method);
                Assert.Equal("/internal/users/accuracy", request.RequestUri?.AbsolutePath);
                Assert.True(request.Headers.TryGetValues("X-Internal-Token", out var values));
                Assert.Contains("internal-test-token", values);

                var payload = await request.Content!.ReadFromJsonAsync<UserIdsPayload>();
                Assert.NotNull(payload);
                Assert.Equal(new[] { "u_accuracy" }, payload!.user_ids);

                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new[]
                    {
                        new UserAccuracy
                        {
                            UserId = "u_accuracy",
                            AdminFakeCorrect = 2,
                            AdminFakeTotal = 3,
                            AdminRealCorrect = 4,
                            AdminRealTotal = 5,
                        }
                    })
                };
            });

            using var httpClient = new HttpClient(handler)
            {
                BaseAddress = new Uri("http://auth-srv:3000"),
            };
            var service = new AuthService(httpClient, NullLogger<AuthService>.Instance);

            var result = await service.GetUsersAccuracyAsync(new List<string> { "u_accuracy" });

            Assert.Single(result);
            Assert.Equal("u_accuracy", result[0].UserId);
            Assert.Equal(2, result[0].AdminFakeCorrect);
        }
        finally
        {
            Environment.SetEnvironmentVariable("INTERNAL_AUTH_TOKEN", previousToken);
        }
    }

    private sealed class UserIdsPayload
    {
        public List<string> user_ids { get; set; } = new();
    }

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, Task<HttpResponseMessage>> _handler;

        public StubHttpMessageHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handler)
        {
            _handler = handler;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            return _handler(request);
        }
    }
}
