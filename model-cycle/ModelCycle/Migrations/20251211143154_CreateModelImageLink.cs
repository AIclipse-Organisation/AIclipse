using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ModelCycle.Migrations
{
    /// <inheritdoc />
    public partial class CreateModelImageLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "ValidationLoss",
                table: "ModelWeights",
                newName: "ValidationRecall");

            migrationBuilder.RenameColumn(
                name: "GoldenTestLoss",
                table: "ModelWeights",
                newName: "ValidationPrecision");

            migrationBuilder.AddColumn<int>(
                name: "GoldenFakeToRealMisclassifications",
                table: "ModelWeights",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "GoldenRealToFakeMisclassifications",
                table: "ModelWeights",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<double>(
                name: "GoldenTestF1Score",
                table: "ModelWeights",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "GoldenTestPrecision",
                table: "ModelWeights",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "GoldenTestRecall",
                table: "ModelWeights",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "ValidationF1Score",
                table: "ModelWeights",
                type: "REAL",
                nullable: false,
                defaultValue: 0.0);

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

            migrationBuilder.DropColumn(
                name: "GoldenFakeToRealMisclassifications",
                table: "ModelWeights");

            migrationBuilder.DropColumn(
                name: "GoldenRealToFakeMisclassifications",
                table: "ModelWeights");

            migrationBuilder.DropColumn(
                name: "GoldenTestF1Score",
                table: "ModelWeights");

            migrationBuilder.DropColumn(
                name: "GoldenTestPrecision",
                table: "ModelWeights");

            migrationBuilder.DropColumn(
                name: "GoldenTestRecall",
                table: "ModelWeights");

            migrationBuilder.DropColumn(
                name: "ValidationF1Score",
                table: "ModelWeights");

            migrationBuilder.RenameColumn(
                name: "ValidationRecall",
                table: "ModelWeights",
                newName: "ValidationLoss");

            migrationBuilder.RenameColumn(
                name: "ValidationPrecision",
                table: "ModelWeights",
                newName: "GoldenTestLoss");
        }
    }
}
