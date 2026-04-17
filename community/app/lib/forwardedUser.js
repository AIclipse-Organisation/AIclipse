import { timingSafeEqual } from "crypto";

function normalizeBooleanHeader(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function safeTokenCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hasTrustedInternalToken(headersLike, expectedInternalToken) {
  const requiredToken = String(expectedInternalToken || "").trim();
  if (!requiredToken) {
    return false;
  }

  const readHeader = (name) => {
    if (!headersLike || typeof headersLike.get !== "function") {
      return "";
    }
    return String(headersLike.get(name) || "").trim();
  };

  const providedToken = readHeader("x-internal-token");
  return safeTokenCompare(providedToken, requiredToken);
}

export function readForwardedTrustedUser(headersLike, expectedInternalToken) {
  const readHeader = (name) => {
    if (!headersLike || typeof headersLike.get !== "function") {
      return "";
    }
    return String(headersLike.get(name) || "").trim();
  };

  if (!hasTrustedInternalToken(headersLike, expectedInternalToken)) {
    return null;
  }

  const user_id = readHeader("x-user-id");
  if (!user_id) {
    return null;
  }

  const email = readHeader("x-user-email") || null;
  const user_name = readHeader("x-user-name") || null;

  return {
    user_id,
    email,
    user_name,
    is_admin: normalizeBooleanHeader(readHeader("x-user-is-admin")),
  };
}
