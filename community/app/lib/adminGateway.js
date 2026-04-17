import { NextResponse } from "next/server";
import { getBrowserAccessToken } from "./browserAccessToken";

export function parseGatewayBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function resolveGatewayUrl(path, query) {
  const gatewayBase = String(process.env.GATEWAY_URI || "").trim();
  if (!gatewayBase) {
    throw new Error("Missing GATEWAY_URI");
  }

  const url = new URL(path.replace(/^\//, ""), gatewayBase.endsWith("/") ? gatewayBase : `${gatewayBase}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
}

export async function getAdminAccessToken() {
  return getBrowserAccessToken();
}

export function buildAdminError(status, error, detail) {
  return NextResponse.json({ error, detail }, { status });
}

export function sanitizeLogMessage(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\r\n]/g, "");
}

function normalizeExternalProto(value) {
  const proto = String(value || "")
    .split(",", 1)[0]
    .trim()
    .toLowerCase();
  if (proto === "http" || proto === "https") {
    return proto;
  }
  return null;
}

function resolveExternalProto(request) {
  if (!request) {
    return null;
  }

  return normalizeExternalProto(
    request.headers?.get("x-forwarded-proto") ||
      new URL(request.url).protocol.replace(":", ""),
  );
}

export async function proxyAdminJson({
  path,
  method = "GET",
  query,
  body,
  headers,
  request,
  successTextKey,
  onError,
}) {
  try {
    const token = await getAdminAccessToken();
    if (!token) {
      return buildAdminError(401, "Unauthorized");
    }

    const requestHeaders = {
      Authorization: `Bearer ${token}`,
      ...(headers || {}),
    };
    const externalProto = resolveExternalProto(request);
    if (externalProto) {
      requestHeaders["X-External-Proto"] = externalProto;
    }
    const init = {
      method,
      headers: requestHeaders,
      cache: "no-store",
    };

    if (body !== undefined) {
      if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === "content-type")) {
        requestHeaders["Content-Type"] = "application/json";
      }
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(resolveGatewayUrl(path, query), init);
    const text = await response.text();
    const payload = parseGatewayBody(text);

    if (!response.ok) {
      const override = onError?.(response, payload, text);
      if (override) {
        return override;
      }
      if (response.status === 401) {
        return buildAdminError(401, "Unauthorized");
      }
      if (response.status === 403) {
        return buildAdminError(403, "Forbidden");
      }
      if (response.status >= 500) {
        return buildAdminError(response.status, "Gateway Error");
      }
      return buildAdminError(response.status, "Gateway Error", payload || text);
    }

    if (typeof payload === "string") {
      return NextResponse.json({ [successTextKey || "message"]: payload }, { status: response.status });
    }

    return NextResponse.json(payload ?? {}, { status: response.status });
  } catch (error) {
    return buildAdminError(500, "Internal Error");
  }
}
