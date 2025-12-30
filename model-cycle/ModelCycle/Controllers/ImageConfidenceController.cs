using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.Domain;
using ModelCycle.Models;
using ModelCycle.Services.ImageConfidence;

namespace ModelCycle.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ImageConfidenceController : ControllerBase
{
    private readonly IConfidenceService _confidenceService;
    private readonly AppDbContext _db;

    public ImageConfidenceController(IConfidenceService confidenceService, AppDbContext db)
    {
        _confidenceService = confidenceService;
        _db = db;
    }

    [HttpPost("evaluate")]
    public async Task<IActionResult> Evaluate([FromBody] EvaluateImageRequest request)
    {
        var image = await _db.TrainingImages.FirstOrDefaultAsync(i => i.PostId == request.PostId);

        if (image == null)
        {
            image = new TrainingImage
            {
                Id = Guid.NewGuid(),
                PostId = request.PostId,
                MediaImageId = request.MediaImageId, 
                S3Key = request.S3Key,
                Label = request.Label, 
                UploadedAt = DateTime.UtcNow,
                Status = TrainingStatus.Pending
            };
            _db.TrainingImages.Add(image);
        }
        
        // is possible this module will obtain the vote data by requests later. 
        image.UserAiVotes = request.UserAiVotes;
        image.UserRealVotes = request.UserNotAiVotes;
        image.ModelConfidenceScore = request.ModelConfidence; 
        
        var voteData = new VoteData
        {
            PostId = request.PostId,
            UserAiVotes = request.UserAiVotes,
            UserNotAiVotes = request.UserNotAiVotes,
            ModelConfidence = request.ModelConfidence 
        };
        
        var result = _confidenceService.Evaluate(voteData);
        
        image.CurrentProbability = result.Probability;

        if (result.IsReadyForTraining)
        {
            image.Status = TrainingStatus.Ready;
            image.Label = result.TrainingLabel; 
        }
        
        await _db.SaveChangesAsync();

        return Ok(new 
        {
            IsReady = result.IsReadyForTraining,
            CurrentProbability = result.Probability,
            Action = result.IsReadyForTraining ? "Promoted to Training Set" : "Waiting for more votes"
        });
    }
}