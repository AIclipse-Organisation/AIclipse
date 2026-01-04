using Microsoft.AspNetCore.Mvc;
using ModelCycle.Domain;
using ModelCycle.Services.Training;

namespace ModelCycle.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ImageConfidenceController : ControllerBase
{
    private readonly ITrainingWorkflowService _workflow;
    private readonly ILogger<ImageConfidenceController> _logger; 
    
    public ImageConfidenceController(
        ITrainingWorkflowService workflow, 
        ILogger<ImageConfidenceController> logger)
    {
        _workflow = workflow;
        _logger = logger;
    }

    [HttpPost("evaluate")]
    public async Task<IActionResult> Evaluate([FromBody] EvaluateImageRequest request)
    {
        _logger.LogInformation("Received vote for Post {PostId} | ID: {MediaId}", request.PostId, request.MediaImageId);
        try 
        {
            var result = await _workflow.ProcessVoteAsync(request);
            if (result.IsReadyForTraining)
            {
                _logger.LogInformation(">>> Image {MediaId} adding to training set.", request.MediaImageId);
            }

            return Ok(new 
            {
                IsReady = result.IsReadyForTraining,
                CurrentProbability = result.Probability,
                Action = result.IsReadyForTraining ? "Added to Training Set" : "Waiting for more votes"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process vote for {MediaId}", request.MediaImageId);
            return BadRequest(ex.Message);
        }
    }
}