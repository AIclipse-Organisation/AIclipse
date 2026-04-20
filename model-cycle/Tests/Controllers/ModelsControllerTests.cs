using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ModelCycle.Controllers;
using ModelCycle.Data;
using ModelCycle.Models;
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
        var controller = new ModelsController(blobStorage.Object, db, new TrainingJobQueue(), deployment.Object);

        var result = await controller.DeleteModel("v2.0.1");

        Assert.IsType<OkObjectResult>(result);
        blobStorage.Verify(b => b.DeleteFileAsync("models/v2.0.1.pt", null), Times.Once);
        Assert.Empty(await db.ModelWeights.ToListAsync());
    }
}
