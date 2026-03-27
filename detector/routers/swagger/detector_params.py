checksv101_params = {
    "parameters": [
        {
            "in": "header",
            "name": "X-Request-Id",
            "required": True,
            "schema": {"type": "string", "example": "test-123"},
            "description": "Correlation ID for logs and tracing"
        },
        {
            "in": "header",
            "name": "X-User-Id",
            "required": False,
            "schema": {"type": "string", "example": "u_123"},
            "description": "User ID for auditing"
        }
    ],
    "requestBody": {
        "content": {
            "application/octet-stream": {
                "schema": {"type": "string", "format": "binary"}
            }
        }
    }
}