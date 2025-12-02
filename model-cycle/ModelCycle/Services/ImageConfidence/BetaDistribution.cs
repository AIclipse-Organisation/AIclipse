using MathNet.Numerics.Distributions;

namespace ModelCycle.Services.ImageConfidence;

public class BetaDistribution: IBetaDistribution
{
    public double Cdf(double x, double alpha, double beta)
    {
        var betaDist = new Beta(alpha, beta);
        return betaDist.CumulativeDistribution(x);
    }
}