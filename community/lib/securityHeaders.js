function normalizeOrigin(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function isProdEnv(env = process.env) {
  const appEnv = String(env.APP_ENV || "").trim().toLowerCase();
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  return appEnv === "prod" || appEnv === "production" || nodeEnv === "production";
}

export function buildStorageOrigins(env = process.env) {
  const configuredOrigin = normalizeOrigin(env.S3_PUBLIC_ENDPOINT);
  if (!configuredOrigin) {
    return [];
  }

  const { host } = new URL(configuredOrigin);
  return [`https://${host}`, `http://${host}`];
}

export function buildSecurityHeaders(env = process.env) {
  const storageOrigins = buildStorageOrigins(env);
  const imageSources = ["'self'", "data:", "blob:", ...storageOrigins];
  const connectSources = ["'self'", ...storageOrigins];
  const scriptSources = ["'self'", "'unsafe-inline'"];

  if (!isProdEnv(env)) {
    scriptSources.push("'unsafe-eval'");
  }

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "frame-ancestors 'none'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ...(isProdEnv(env)
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" }]
      : []),
  ];
}


export function applySecurityHeaders(response, env = process.env) {
  for (const { key, value } of buildSecurityHeaders(env)) {
    response.headers.set(key, value);
  }
  return response;
}
