# Model Cycle Module

This module provides functionality for deciding on whether model training should commence, and trains models on new training data.

In the future this module will include:

- Data ingestion logic
- Training cycle management
- Model versioning
- Integration with other modules

### Services

- ImageConfidence
- ... MORE SERVICES TO BE ADDED

### Image Confidence

Checks image properties (user votes, model confidence) and transforms into posterior mean. Transforms this mean into a beta distribution and checks it against set threshold to see if image and label is ready to be added to training set.

## Inputs

- User vote counts
- Model confidence score
- Estimated accuracies for users and model (Will be per user accuracy in the future)

---

## Outputs

A `(alpha, beta, posterior_mean, verdict)` structure:

- `alpha`: strength of belief for “AI”
- `beta`: strength of belief for “Real”
- `posterior_mean`: final confidence score between 0 and 1
- `verdict`: `"ai"` or `"real"`

---

## Module Structure

```text
model-cycle/
 ├─ ModelCycle/
 │   ├─ Controllers/
 │   ├─ Domain/
 │   │   ├─ ImageVote.cs
 │   │   └─ ConfidenceResult.cs
 │   ├─ Python/
 │   │   (future: training script)
 │   ├─ Services/
 │   │   └─ ImageConfidence/
 │   │       ├─ ConfidenceService.cs
 │   │       ├─ IBetaDistribution.cs
 │   │       └─ BetaDistribution.cs
 │   ├─ Tests/
 │   │   └─ ImageConfidence/
 │   │       └─ ConfidenceServiceTests.cs
 │   ├─ ModelCycle.csproj
 │   └─ Program.cs
 ├─ Dockerfile
 └─ .dockerignore

```
