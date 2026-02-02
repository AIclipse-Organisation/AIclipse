using Microsoft.EntityFrameworkCore;
using ModelCycle.Data;
using ModelCycle.Models;

namespace ModelCycle.Repositories;

public class ModelWeightsRepository : IModelWeightsRepository
{
    private readonly AppDbContext _context;

    public ModelWeightsRepository(AppDbContext context)
    {
        _context = context;
    }

    public async Task<ModelWeights?> GetByVersionAsync(string version)
    {
        return await _context.ModelWeights
            .AsNoTracking() 
            .FirstOrDefaultAsync(m => m.Version == version);
    }

    public async Task<ModelWeights?> GetDeployedModelAsync()
    {
        return await _context.ModelWeights
            .AsNoTracking()
            .OrderByDescending(m => m.CreatedAt) 
            .FirstOrDefaultAsync(m => m.IsDeployed);
    }
}