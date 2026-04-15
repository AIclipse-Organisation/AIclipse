// Gamification scoring system
// Tracks user points and streaks for community engagement.
// All mutations go through auth's internal API — no direct DB writes.

import { recordUserActivity } from "@/lib/auth/authInternal.js";

export const SCORES = {
    COMMENT: 1,
    VOTE: 1,
    CREATE_POST: 5,
    RECEIVE_ENGAGEMENT: 1, // When someone comments/votes on your post
    CORRECT_ADMIN_VOTE: 10, // Voting correctly on admin-created posts
};

/**
 * Award points to a user (also updates streak via auth activity endpoint).
 * @param {string} userId
 * @param {number} points
 * @param {string} reason - For logging
 */
export async function awardPoints(userId, points, reason = "activity") {
    if (!userId || !points || points <= 0) return;

    try {
        await recordUserActivity(userId, points);
    } catch (err) {
        console.error(`Failed to award ${points} points to ${userId} for ${reason}:`, err);
    }
}

/**
 * Award points and update streak in one call.
 * Use this for most user activities.
 */
export async function recordActivity(userId, points, reason = "activity") {
    if (!userId) return;

    try {
        await recordUserActivity(userId, points);
    } catch (err) {
        console.error(`Failed to record activity for ${userId} (${reason}):`, err);
    }
}
