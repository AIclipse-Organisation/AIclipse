using System;
using ModelCycle.Domain;
using ModelCycle.Services.ImageConfidence;
using Xunit;

namespace Tests.ImageConfidence;

 public class ConfidenceServiceTests
    {
        private readonly ConfidenceService _service;

        public ConfidenceServiceTests()
        {
            _service = new ConfidenceService(new BetaDistribution());
        }
        
        private (double alpha, double beta) ComputeExpectedAlphaBeta(int userAi, int userNot, double modelConf)
        {
            double userAccuracyAi = 0.8;
            double userAccuracyReal = 0.8;

            double modelAccuracyAi = 0.8;
            double modelAccuracyReal = 0.8;

            double userAiVal   = userAccuracyAi          * userAi;
            double userAiNotVal = (1 - userAccuracyReal)  * userNot;
            double userRealVal  = userAccuracyReal        * userNot;
            double userRealNotVal= (1 - userAccuracyAi)    * userAi;

            double modelAiVal = modelConf * modelAccuracyAi;
            double modelAiNotVal = (1 - modelConf) * (1 - modelAccuracyReal);

            double modelRealVal  = (1 - modelConf) * modelAccuracyReal;
            double modelRealNotVal = modelConf * (1 - modelAccuracyAi);

            double alpha = 1 + userAiVal + userAiNotVal + modelAiVal + modelAiNotVal;
            double beta = 1 + userRealVal + userRealNotVal + modelRealVal + modelRealNotVal;

            return (alpha, beta);
        }
        
        [Fact]
        public void AlphaBeta_CorrectlyComputed_WithWeightedVotes()
        {
            var vote = new VoteData
            {
                UserAiVotes = 2,
                UserNotAiVotes = 3,
                ModelConfidence = 0.7
            };

            var expected = ComputeExpectedAlphaBeta(2, 3, 0.7);
            var result = _service.Evaluate(vote);

            Assert.Equal(expected.alpha, result.Alpha, 5);
            Assert.Equal(expected.beta, result.Beta, 5);
        }
        
        [Fact]
        public void StrongRealVotes_ProduceRealLabel()
        {
            var vote = new VoteData
            {
                UserAiVotes = 0,
                UserNotAiVotes = 10,
                ModelConfidence = 0.2
            };

            var result = _service.Evaluate(vote);

            Assert.Equal("real", result.TrainingLabel);
        }
        
        [Fact]
        public void StrongAiVotes_ProduceAiLabel()
        {
            var vote = new VoteData
            {
                UserAiVotes = 10,
                UserNotAiVotes = 0,
                ModelConfidence = 0.8
            };

            var result = _service.Evaluate(vote);

            Assert.Equal("ai", result.TrainingLabel);
        }
        
        [Fact]
        public void PosteriorMean_BetweenZeroAndOne()
        {
            var vote = new VoteData
            {
                UserAiVotes = 3,
                UserNotAiVotes = 3,
                ModelConfidence = 0.5
            };

            var result = _service.Evaluate(vote);

            Assert.InRange(result.PosteriorMean, 0.0, 1.0);
        }
        
        [Fact]
        public void Probability_Computed_ForBothLabels()
        {
            var vote = new VoteData
            {
                UserAiVotes = 4,
                UserNotAiVotes = 4,
                ModelConfidence = 0.5
            };

            var result = _service.Evaluate(vote);

            Assert.True(result.Probability > 0);
            Assert.True(result.Probability < 1);
        }
        
        [Fact]
        public void HighCertainty_AboveThreshold_IsReadyForTraining()
        {
            var vote = new VoteData
            {
                UserAiVotes = 10,
                UserNotAiVotes = 1,
                ModelConfidence = 0.9
            };
            var result = _service.Evaluate(vote);

            Assert.True(result.Probability >= 0.8);
            Assert.True(result.IsReadyForTraining);
        }
        
        [Fact]
        public void LowCertainty_BelowThreshold_NotReadyForTraining()
        {
            var vote = new VoteData
            {
                UserAiVotes = 1,
                UserNotAiVotes = 1,
                ModelConfidence = 0.5
            };

            var result = _service.Evaluate(vote);

            Assert.True(result.Probability < 0.9);
            Assert.False(result.IsReadyForTraining);
        }
    }