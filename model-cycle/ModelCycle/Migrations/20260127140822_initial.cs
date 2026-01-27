using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ModelCycle.Migrations
{
    /// <inheritdoc />
    public partial class initial : Migration
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
                    ValidationPrecision = table.Column<double>(type: "REAL", nullable: false),
                    ValidationRecall = table.Column<double>(type: "REAL", nullable: false),
                    ValidationF1Score = table.Column<double>(type: "REAL", nullable: false),
                    GoldenTestAccuracy = table.Column<double>(type: "REAL", nullable: false),
                    GoldenTestPrecision = table.Column<double>(type: "REAL", nullable: false),
                    GoldenTestRecall = table.Column<double>(type: "REAL", nullable: false),
                    GoldenTestF1Score = table.Column<double>(type: "REAL", nullable: false),
                    GoldenFakeToRealMisclassifications = table.Column<int>(type: "INTEGER", nullable: false),
                    GoldenRealToFakeMisclassifications = table.Column<int>(type: "INTEGER", nullable: false),
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
                    PostId = table.Column<string>(type: "TEXT", nullable: true),
                    MediaImageId = table.Column<string>(type: "TEXT", nullable: false),
                    S3Key = table.Column<string>(type: "TEXT", nullable: false),
                    UserAiVotes = table.Column<int>(type: "INTEGER", nullable: false),
                    UserRealVotes = table.Column<int>(type: "INTEGER", nullable: false),
                    ModelConfidenceScore = table.Column<double>(type: "REAL", nullable: false),
                    CurrentProbability = table.Column<double>(type: "REAL", nullable: false),
                    Label = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    UploadedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    ModelVersion = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrainingImages", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ModelImageLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    ModelWeightId = table.Column<Guid>(type: "TEXT", nullable: false),
                    TrainingImageId = table.Column<Guid>(type: "TEXT", nullable: false),
                    UsageType = table.Column<int>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ModelImageLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ModelImageLinks_ModelWeights_ModelWeightId",
                        column: x => x.ModelWeightId,
                        principalTable: "ModelWeights",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ModelImageLinks_TrainingImages_TrainingImageId",
                        column: x => x.TrainingImageId,
                        principalTable: "TrainingImages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ModelImageLinks_ModelWeightId",
                table: "ModelImageLinks",
                column: "ModelWeightId");

            migrationBuilder.CreateIndex(
                name: "IX_ModelImageLinks_TrainingImageId",
                table: "ModelImageLinks",
                column: "TrainingImageId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ModelImageLinks");

            migrationBuilder.DropTable(
                name: "ModelWeights");

            migrationBuilder.DropTable(
                name: "TrainingImages");
        }
    }
}
