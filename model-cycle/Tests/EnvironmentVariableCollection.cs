using Xunit;

namespace Tests;

[CollectionDefinition(Name, DisableParallelization = true)]
public sealed class EnvironmentVariableCollection : ICollectionFixture<EnvironmentVariableCollectionFixture>
{
    public const string Name = "Environment variable tests";
}

public sealed class EnvironmentVariableCollectionFixture
{
}
