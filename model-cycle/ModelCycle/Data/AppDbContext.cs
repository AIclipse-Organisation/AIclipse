namespace ModelCycle.Data;

using Microsoft.EntityFrameworkCore;
using ModelCycle.Models;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<TrainingImage> TrainingImages { get; set; }
    
    public DbSet<ModelWeights> ModelWeights { get; set; }
    
    public DbSet<ModelImageLink> ModelImageLinks { get; set; }
}