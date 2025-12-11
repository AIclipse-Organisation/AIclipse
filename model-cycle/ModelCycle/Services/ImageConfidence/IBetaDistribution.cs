namespace ModelCycle.Services.ImageConfidence;

public interface  IBetaDistribution
{
    double Cdf(double x, double alpha, double beta);
}