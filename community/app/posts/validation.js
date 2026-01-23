// Shared validation utilities for community routes

// Validates user_id format to prevent injection attacks and invalid data
// Returns { valid: boolean, value?: string, error?: string }
export function validateUserId(user_id) {
  // Must be a string
  if (typeof user_id !== "string") {
    return { valid: false, error: "user_id must be a string" };
  }

  // Must not be empty
  const trimmed = user_id.trim();
  if (!trimmed) {
    return { valid: false, error: "user_id cannot be empty" };
  }

  // Reasonable length check (prevent DoS)
  if (trimmed.length > 100) {
    return { valid: false, error: "user_id too long" };
  }

  // Format check: alphanumeric, hyphens, underscores only (common ID format)
  // Adjust pattern based on your actual user_id format
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmed)) {
    return { valid: false, error: "user_id contains invalid characters" };
  }

  // Return sanitized string value for safe use in MongoDB queries
  return { valid: true, value: String(trimmed) };
}

// Validates post_id format
export function validatePostId(post_id) {
  if (typeof post_id !== "string") {
    return { valid: false, error: "post_id must be a string" };
  }

  const trimmed = post_id.trim();
  if (!trimmed) {
    return { valid: false, error: "post_id cannot be empty" };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: "post_id too long" };
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmed)) {
    return { valid: false, error: "post_id contains invalid characters" };
  }

  return { valid: true, value: String(trimmed) };
}

// Validates image_id format
export function validateImageId(image_id) {
  if (typeof image_id !== "string") {
    return { valid: false, error: "image_id must be a string" };
  }

  const trimmed = image_id.trim();
  if (!trimmed) {
    return { valid: false, error: "image_id cannot be empty" };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: "image_id too long" };
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmed)) {
    return { valid: false, error: "image_id contains invalid characters" };
  }

  return { valid: true, value: String(trimmed) };
}

// Validates comment_id format
export function validateCommentId(comment_id) {
  if (typeof comment_id !== "string") {
    return { valid: false, error: "comment_id must be a string" };
  }

  const trimmed = comment_id.trim();
  if (!trimmed) {
    return { valid: false, error: "comment_id cannot be empty" };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: "comment_id too long" };
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(trimmed)) {
    return { valid: false, error: "comment_id contains invalid characters" };
  }

  return { valid: true, value: String(trimmed) };
}
