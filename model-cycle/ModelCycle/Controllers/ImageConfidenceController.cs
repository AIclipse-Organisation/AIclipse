using Microsoft.AspNetCore.Mvc;
using ModelCycle.Domain;
using ModelCycle.Security;
using ModelCycle.Services.Training;

namespace ModelCycle.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ImageConfidenceController : ControllerBase
{
    private readonly ITrainingWorkflowService _workflow;
    private readonly ILogger<ImageConfidenceController> _logger;
    private readonly IInternalRequestAuthorizer _requestAuthorizer;

    public ImageConfidenceController(
        ITrainingWorkflowService workflow,
        ILogger<ImageConfidenceController> logger,
        IInternalRequestAuthorizer requestAuthorizer)
    {
        _workflow = workflow;
        _logger = logger;
        _requestAuthorizer = requestAuthorizer;
    }

    [HttpPost("evaluate")]
    public async Task<IActionResult> Evaluate([FromBody] EvaluateImageRequest request)
    {
        var authFailure = _requestAuthorizer.RequireInternalRequest(Request);
        if (authFailure != null)
        {
            return authFailure;
        }

        try
        {
            var result = await _workflow.ProcessVoteAsync(request);
            if (result.IsReadyForTraining)
            {
                _logger.LogInformation(">>> Image adding to training set.");
            }

            return Ok(new
            {
                Label = result.TrainingLabel,
                IsReady = result.IsReadyForTraining,
                CurrentProbability = result.Probability,
                Action = result.IsReadyForTraining ? "Added to Training Set" : "Waiting for more votes"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process vote");
            return BadRequest(ex.Message);
        }
    }
}