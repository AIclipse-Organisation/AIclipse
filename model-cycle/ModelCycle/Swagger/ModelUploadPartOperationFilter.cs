using Microsoft.OpenApi.Models;
using ModelCycle.Controllers;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace ModelCycle.Swagger;

public sealed class ModelUploadPartOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        if (context.MethodInfo.DeclaringType != typeof(ModelsController) ||
            context.MethodInfo.Name != nameof(ModelsController.UploadPart))
        {
            return;
        }

        operation.Summary ??= "Upload one staged model chunk";
        operation.Description =
            "Streams one numbered binary chunk into the active admin upload session. " +
            "Chunks must arrive in order and match the approved chunk size for the session.";

        operation.RequestBody = new OpenApiRequestBody
        {
            Required = true,
            Content =
            {
                ["application/octet-stream"] = new OpenApiMediaType
                {
                    Schema = new OpenApiSchema
                    {
                        Type = "string",
                        Format = "binary",
                        Description = "Raw bytes for the requested upload part.",
                    },
                },
            },
        };

        foreach (var parameter in operation.Parameters)
        {
            if (parameter.In == ParameterLocation.Header &&
                string.Equals(parameter.Name, "X-Upload-Id", StringComparison.OrdinalIgnoreCase))
            {
                parameter.Description = "Opaque upload session token returned by POST /api/models/uploads.";
                parameter.Required = true;
            }

            if (parameter.In == ParameterLocation.Path &&
                string.Equals(parameter.Name, "partNumber", StringComparison.Ordinal))
            {
                parameter.Description = "1-based sequential part number within the active upload session.";
            }
        }
    }
}
