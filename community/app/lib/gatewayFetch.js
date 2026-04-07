function buildGatewayFetchError(status, detail) {
  const error = new Error(detail || `Gateway request failed (${status})`);
  error.status = status;
  return error;
}

function parseJsonBody(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function timeoutMessage(errorPrefix, timeoutMs) {
  return `${errorPrefix || "Gateway request"} timed out after ${timeoutMs}ms`;
}

export async function fetchGatewayJson(url, init = {}, { timeoutMs = 5000, errorPrefix } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = parseJsonBody(text);

    if (!response.ok) {
      throw buildGatewayFetchError(
        response.status,
        payload?.detail ||
          payload?.error ||
          text ||
          (errorPrefix
            ? `${errorPrefix} (${response.status})`
            : `Gateway request failed (${response.status})`),
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (text && contentType.includes("application/json") && payload === null) {
      throw buildGatewayFetchError(
        502,
        errorPrefix ? `${errorPrefix} returned invalid JSON` : "Gateway returned invalid JSON",
      );
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw buildGatewayFetchError(504, timeoutMessage(errorPrefix, timeoutMs));
    }
    if (error?.status) {
      throw error;
    }
    throw buildGatewayFetchError(
      502,
      errorPrefix ? `${errorPrefix} unavailable` : "Gateway request failed",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
