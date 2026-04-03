function normalizeBooleanHeader(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function readForwardedTrustedUser(headersLike, expectedInternalToken) {
  const requiredToken = String(expectedInternalToken || "").trim();
  if (!requiredToken) {
    return null;
  }

  const readHeader = (name) => {
    if (!headersLike || typeof headersLike.get !== "function") {
      return "";
    }
    return String(headersLike.get(name) || "").trim();
  };

  const providedToken = readHeader("x-internal-token");
  if (!providedToken || providedToken !== requiredToken) {
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
