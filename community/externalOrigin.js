export function getExternalOriginFromHeaders(h, fallbackOrigin = "") {
  const protoRaw = h.get("x-forwarded-proto") || "";
  const proto = (protoRaw.split(",")[0].trim() || "http").toLowerCase();

  const hostRaw = h.get("x-forwarded-host") || h.get("host") || "";
  const host = hostRaw.split(",")[0].trim();

  if (!host) return fallbackOrigin || "";
  return `${proto}://${host}`;
}

export function getLoginUrlFromHeaders(h, fallbackOrigin = "") {
  const origin = getExternalOriginFromHeaders(h, fallbackOrigin);
  if (!origin) return "/login";
  return new URL("/login", origin).toString();
}

export function isHttpsFromHeaders(h) {
  const protoRaw = h.get("x-forwarded-proto") || "";
  const proto = (protoRaw.split(",")[0].trim() || "http").toLowerCase();
  return proto === "https";
}
