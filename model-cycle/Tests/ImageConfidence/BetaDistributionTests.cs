using ModelCycle.Services.ImageConfidence;
using Xunit;

namespace Tests.ImageConfidence;

public class BetaDistributionTests
{
    [Fact]
    public void Cdf_ReturnsValueBetweenZeroAndOne()
    {
        var beta = new BetaDistribution();
        var result = beta.Cdf(0.5, 2, 3);

        Assert.InRange(result, 0, 1);
    }

    [Fact]
    public void Cdf_UniformDistribution_AtHalf_ReturnsHalf()
    {
        var beta = new BetaDistribution();
        var result = beta.Cdf(0.5, 1, 1);

        Assert.Equal(0.5, result, precision: 3);
    }
}