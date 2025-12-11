using Microsoft.AspNetCore.Mvc;
using ModelCycle.Domain;
using ModelCycle.Services.ImageConfidence;

namespace ModelCycle.Controllers;

public class ImageConfidenceController:ControllerBase
{
    private readonly IConfidenceService _confidence;

    public ImageConfidenceController(IConfidenceService confidence)
    {
        _confidence = confidence;
    }

    [HttpPost("/confidence")]
    public IActionResult Evaluate(ImageVote vote)
    {
        var result = _confidence.Evaluate(vote);
        return Ok(result);
    }
}