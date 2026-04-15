// HTTP client for auth service internal API.
// All user-data mutations (stats, activity, streaks) go through auth
// instead of writing to auth.users directly.

const AUTH_URI = process.env.AUTH_URI;
const INTERNAL_AUTH_TOKEN = process.env.INTERNAL_AUTH_TOKEN;

function headers() {
    return {
        "Content-Type": "application/json",
        ...(INTERNAL_AUTH_TOKEN ? { "X-Internal-Token": INTERNAL_AUTH_TOKEN } : {}),
    };
}

/**
 * Increment allowed stat fields on a user (total_guesses, admin_guesses_total, etc.).
 * Maps to POST /internal/user/:userId/stats
 */
export async function incrementUserStats(userId, inc) {
    if (!AUTH_URI || !INTERNAL_AUTH_TOKEN) {
        throw new Error("AUTH_URI or INTERNAL_AUTH_TOKEN not configured");
    }
    const resp = await fetch(`${AUTH_URI}/internal/user/${userId}/stats`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ inc }),
        cache: "no-store",
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Auth stats update failed: ${resp.status} ${text}`);
    }
    return resp.json();
}

/**
 * Award points and update streak for a user.
 * Maps to POST /internal/user/:userId/activity
 */
export async function recordUserActivity(userId, points = 0) {
    if (!AUTH_URI || !INTERNAL_AUTH_TOKEN) {
        throw new Error("AUTH_URI or INTERNAL_AUTH_TOKEN not configured");
    }
    const resp = await fetch(`${AUTH_URI}/internal/user/${userId}/activity`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ points }),
        cache: "no-store",
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Auth activity update failed: ${resp.status} ${text}`);
    }
    return resp.json();
}
