using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ModelCycle.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ModelWeights",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Version = table.Column<string>(type: "TEXT", nullable: false),
                    MinioObjectPath = table.Column<string>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    NewImagesCount = table.Column<int>(type: "INTEGER", nullable: false),
                    ReplayBufferCount = table.Column<int>(type: "INTEGER", nullable: false),
                    ValidationAccuracy = table.Column<double>(type: "REAL", nullable: false),
                    ValidationLoss = table.Column<double>(type: "REAL", nullable: false),
                    GoldenTestAccuracy = table.Column<double>(type: "REAL", nullable: false),
                    GoldenTestLoss = table.Column<double>(type: "REAL", nullable: false),
                    IsDeployed = table.Column<bool>(type: "INTEGER", nullable: false),
                    RejectionReason = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ModelWeights", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TrainingImages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    OriginalBucketId = table.Column<Guid>(type: "TEXT", nullable: false),
                    MinioObjectPath = table.Column<string>(type: "TEXT", nullable: false),
                    Label = table.Column<string>(type: "TEXT", nullable: false),
                    UploadedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingImages", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ModelWeights");

            migrationBuilder.DropTable(
                name: "TrainingImages");
        }
    }
}
