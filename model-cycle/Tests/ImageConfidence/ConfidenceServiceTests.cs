using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Options;
using ModelCycle;
using ModelCycle.Models;
using ModelCycle.Services.ImageConfidence;
using Xunit;

namespace Tests.ImageConfidence;

public class ConfidenceServiceTests
{
    private readonly ConfidenceService _service;
    private readonly ModelWeights _modelWeights;

    public ConfidenceServiceTests()
    {
        var config = Options.Create(new ModelCycleConfig
        {
            ConfidenceScoring = new ConfidenceScoringConfig
            {
                UserAccuracyAi = 0.8,
                UserAccuracyReal = 0.8,
                ConfidenceThreshold = 0.8
            }
        });
        _service = new ConfidenceService(new BetaDistribution(), config);
        _modelWeights = new ModelWeights
        {
            GoldenTestPrecision = 0.8,
            GoldenTestRecall = 0.8
        };
    }

    private static UserVoteWithMetrics MakeVote(string userId, bool isAi, double reliability = 0.8)
    {
        // GetCurrentReliability() = (correct + 1) / (total + 2). Solve for counts
        // that yield the requested reliability (using total=8 gives neat numbers).
        int total = 8;
        int correct = (int)Math.Round(reliability * (total + 2.0) - 1.0);
        var metrics = new UserAccuracy
        {
            UserId = userId,
            AdminFakeCorrect = isAi ? correct : 0,
            AdminFakeTotal = isAi ? total : 0,
            AdminRealCorrect = isAi ? 0 : correct,
            AdminRealTotal = isAi ? 0 : total,
        };
        return new UserVoteWithMetrics { UserId = userId, IsAiVote = isAi, Metrics = metrics };
    }

    [Fact]
    public void StrongRealVotes_ProduceRealLabel()
    {
        var vote = new WeightedVoteData
        {
            PostId = "p1",
            Label = "real",
            ModelConfidence = 0.2,
            Votes = Enumerable.Range(0, 10).Select(i => MakeVote($"u{i}", isAi: false)).ToList()
        };

        var result = _service.Evaluate(vote, _modelWeights);

        Assert.Equal("real", result.TrainingLabel);
    }

    [Fact]
    public void StrongAiVotes_ProduceAiLabel()
    {
        var vote = new WeightedVoteData
        {
            PostId = "p2",
            Label = "ai",
            ModelConfidence = 0.8,
            Votes = Enumerable.Range(0, 10).Select(i => MakeVote($"u{i}", isAi: true)).ToList()
        };

        var result = _service.Evaluate(vote, _modelWeights);

        Assert.Equal("ai", result.TrainingLabel);
    }

    [Fact]
    public void PosteriorMean_BetweenZeroAndOne()
    {
        var vote = new WeightedVoteData
        {
            PostId = "p3",
            Label = "ai",
            ModelConfidence = 0.5,
            Votes = new List<UserVoteWithMetrics>
            {
                MakeVote("u1", isAi: true),
                MakeVote("u2", isAi: true),
                MakeVote("u3", isAi: true),
                MakeVote("u4", isAi: false),
                MakeVote("u5", isAi: false),
                MakeVote("u6", isAi: false),
            }
        };

        var result = _service.Evaluate(vote, _modelWeights);

        Assert.InRange(result.PosteriorMean, 0.0, 1.0);
    }

    [Fact]
    public void Probability_Computed_ForBothLabels()
    {
        var vote = new WeightedVoteData
        {
            PostId = "p4",
            Label = "ai",
            ModelConfidence = 0.5,
            Votes = Enumerable.Range(0, 4).Select(i => MakeVote($"a{i}", isAi: true))
                .Concat(Enumerable.Range(0, 4).Select(i => MakeVote($"r{i}", isAi: false)))
                .ToList()
        };

        var result = _service.Evaluate(vote, _modelWeights);

        Assert.True(result.Probability > 0);
        Assert.True(result.Probability < 1);
    }

    [Fact]
    public void HighCertainty_AboveThreshold_IsReadyForTraining()
    {
        var vote = new WeightedVoteData
        {
            PostId = "p5",
            Label = "ai",
            ModelConfidence = 0.9,
            Votes = Enumerable.Range(0, 10).Select(i => MakeVote($"u{i}", isAi: true)).ToList()
        };

        var result = _service.Evaluate(vote, _modelWeights);

        Assert.True(result.Probability >= 0.8);
        Assert.True(result.IsReadyForTraining);
    }

    [Fact]
    public void LowCertainty_BelowThreshold_NotReadyForTraining()
    {
        var vote = new WeightedVoteData
        {
            PostId = "p6",
            Label = "ai",
            ModelConfidence = 0.5,
            Votes = new List<UserVoteWithMetrics>
            {
                MakeVote("u1", isAi: true),
                MakeVote("u2", isAi: false),
            }
        };

        var result = _service.Evaluate(vote, _modelWeights);

        Assert.True(result.Probability < 0.9);
        Assert.False(result.IsReadyForTraining);
    }
}
