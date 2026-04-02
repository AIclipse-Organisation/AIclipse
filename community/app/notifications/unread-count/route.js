import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
// Use shared cleanup/index helpers so this endpoint matches list/read behavior.
import { ensureNotificationIndexes, trimNotificationRetention } from "@/lib/notifications/notifications.js";
import { getTrustedUser } from "@/app/lib/trustedUser";

export const runtime = "nodejs";

const NOTIFICATIONS_COLLECTION = "community.notifications";

export async function GET(req) {
  try {
    let currentUser;
    try {
      currentUser = getTrustedUser(req);
    } catch (authErr) {
      return NextResponse.json(
        { error: "Unauthorized", detail: String(authErr) },
        { status: 401 },
      );
    }
    const authenticatedUserId = currentUser.user_id;

    const db = await getDb();

    // Run maintenance best-effort; do not block unread count.
    // Ensures indexes exist so unread queries stay fast.
    try {
      await ensureNotificationIndexes(db);
    } catch (err) {
      console.warn("[notifications] index ensure failed on unread-count:", String(err));
    }

    // Removes stale notifications (older than 30 days) to keep
    // storage bounded and unread stats representative of current activity.
    try {
      await trimNotificationRetention(db);
    } catch (err) {
      console.warn("[notifications] retention trim failed on unread-count:", String(err));
    }

    // Count only unread rows for the authenticated recipient.
    const unread_count = await db.collection(NOTIFICATIONS_COLLECTION).countDocuments({
      recipient_user_id: authenticatedUserId,
      is_read: false,
    });

    return NextResponse.json({ unread_count }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load unread count", detail: String(err) },
      { status: 500 },
    );
  }
}
