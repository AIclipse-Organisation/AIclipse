using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ModelCycle.Controllers;
using ModelCycle.Data;
using ModelCycle.Models;
using ModelCycle.Security;
using ModelCycle.Services;
using ModelCycle.Services.Training;
using Moq;
using Xunit;

namespace Tests.Controllers;

public class ModelsControllerTests
{
    [Fact]
    public async Task DeleteModel_RemovesStoredObjectUsingFullObjectPath()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new AppDbContext(options);
        db.ModelWeights.Add(new ModelWeights
        {
            Id = Guid.NewGuid(),
            Version = "v2.0.1",
            MinioObjectPath = "models/v2.0.1.pt",
            IsDeployed = false,
        });
        await db.SaveChangesAsync();

        var blobStorage = new Mock<IBlobStorageService>();
        var deployment = new Mock<IModelDeploymentService>();
        var authorizer = new Mock<IInternalRequestAuthorizer>();
        authorizer.Setup(a => a.RequireForwardedAdmin(It.IsAny<HttpRequest>())).Returns((IActionResult)null);
        var controller = new ModelsController(
            blobStorage.Object,
            db,
            new TrainingJobQueue(),
            deployment.Object,
            authorizer.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext(),
            },
        };

        var result = await controller.DeleteModel("v2.0.1");

        Assert.IsType<OkObjectResult>(result);
        blobStorage.Verify(b => b.DeleteFileAsync("models/v2.0.1.pt", null), Times.Once);
        Assert.Empty(await db.ModelWeights.ToListAsync());
    }

    [Fact]
    public async Task TriggerManualTraining_RejectsNonAdminInternalRequests()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        await using var db = new AppDbContext(options);
        var blobStorage = new Mock<IBlobStorageService>();
        var deployment = new Mock<IModelDeploymentService>();
        var authorizer = new Mock<IInternalRequestAuthorizer>();
        authorizer.Setup(a => a.RequireForwardedAdmin(It.IsAny<HttpRequest>()))
            .Returns(new ObjectResult(new { detail = "Admin privileges required" }) { StatusCode = 403 });

        var controller = new ModelsController(
            blobStorage.Object,
            db,
            new TrainingJobQueue(),
            deployment.Object,
            authorizer.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext(),
            },
        };

        var result = await controller.TriggerManualTraining();

        var forbidden = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, forbidden.StatusCode);
    }
}
