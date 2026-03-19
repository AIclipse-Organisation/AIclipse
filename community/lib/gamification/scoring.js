// Gamification scoring system
// Tracks user points and streaks for community engagement

const USERS_COLLECTION = "auth.users";

// Scoring rules
export const SCORES = {
    COMMENT: 1,
    VOTE: 1,
    CREATE_POST: 5,
    RECEIVE_ENGAGEMENT: 1, // When someone comments/votes on your post
    CORRECT_ADMIN_VOTE: 10, // Voting correctly on admin-created posts
};

/**
 * Award points to a user
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID to award points to
 * @param {number} points - Number of points to award
 * @param {string} reason - Reason for awarding points (for logging)
 */
export async function awardPoints(db, userId, points, reason = "activity") {
    if (!userId || !points || points <= 0) return;

    try {
        const usersCol = db.collection(USERS_COLLECTION);

        await usersCol.updateOne(
            { user_id: userId },
            {
                $inc: { community_score: points },
                $set: { last_activity_date: new Date() }
            }
        );
    } catch (err) {
        console.error(`Failed to award ${points} points to ${userId} for ${reason}:`, err);
    }
}

/**
 * Update user's streak based on activity
 * A streak is maintained if user is active on consecutive days
 * @param {Object} db - MongoDB database instance
 * @param {string} userId - User ID to update streak for
 */
export async function updateStreak(db, userId) {
    if (!userId) return;

    try {
        const usersCol = db.collection(USERS_COLLECTION);
        const user = await usersCol.findOne(
            { user_id: userId },
            { projection: { last_activity_date: 1, current_streak: 1, longest_streak: 1 } }
        );

        if (!user) return;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const lastActivity = user.last_activity_date
            ? new Date(user.last_activity_date)
            : null;

        const lastActivityDay = lastActivity
            ? new Date(lastActivity.getFullYear(), lastActivity.getMonth(), lastActivity.getDate())
            : null;

        let currentStreak = user.current_streak || 0;
        let longestStreak = user.longest_streak || 0;

        if (!lastActivityDay) {
            // First activity ever
            currentStreak = 1;
        } else {
            const daysDiff = Math.floor((today - lastActivityDay) / (1000 * 60 * 60 * 24));

            if (daysDiff === 0) {
                // Same day, no change to streak
                return;
            } else if (daysDiff === 1) {
                // Consecutive day, increment streak
                currentStreak += 1;
            } else {
                // Streak broken, reset to 1
                currentStreak = 1;
            }
        }

        // Update longest streak if current is higher
        if (currentStreak > longestStreak) {
            longestStreak = currentStreak;
        }

        await usersCol.updateOne(
            { user_id: userId },
            {
                $set: {
                    current_streak: currentStreak,
                    longest_streak: longestStreak,
                    last_activity_date: now
                }
            }
        );
    } catch (err) {
        console.error(`Failed to update streak for ${userId}:`, err);
    }
}

/**
 * Award points and update streak in one call
 * Use this for most user activities
 */
export async function recordActivity(db, userId, points, reason = "activity") {
    await Promise.all([
        awardPoints(db, userId, points, reason),
        updateStreak(db, userId)
    ]);
}
