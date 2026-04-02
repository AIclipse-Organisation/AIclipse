import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import {
  ensureNotificationIndexes,
  trimNotificationRetention,
  capNotificationsForUser,
} from "@/lib/notifications/notifications.js";
import { getTrustedUser } from "@/app/lib/trustedUser";

export const runtime = "nodejs";

const NOTIFICATIONS_COLLECTION = "community.notifications";
const USERS_COLLECTION = "auth.users";

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

    const { searchParams } = new URL(req.url);
    const unreadOnly = String(searchParams.get("unread_only") || "").toLowerCase() === "true";

    const db = await getDb();

    try {
      await ensureNotificationIndexes(db);
    } catch (err) {
      console.warn("[notifications] index ensure failed on list:", String(err));
    }

    // delete old notifications (older than 30 days)
    // to prevent unbounded growth and remove stale notification history.
    try {
      await trimNotificationRetention(db);
    } catch (err) {
      console.warn("[notifications] retention trim failed on list:", String(err));
    }

    // Keep only newest notifications for this user so response stays lightweight.
    try {
      await capNotificationsForUser(db, authenticatedUserId, 50);
    } catch (err) {
      console.warn("[notifications] cap enforcement failed on list:", String(err));
    }

    const notificationsCol = db.collection(NOTIFICATIONS_COLLECTION);
    const usersCol = db.collection(USERS_COLLECTION);

    // Always scope query to the authenticated recipient.
    const filter = { recipient_user_id: authenticatedUserId };
    if (unreadOnly) filter.is_read = false;

    const rawItems = await notificationsCol
      .find(filter, { projection: { _id: 0 } })
      // Sort by latest activity so newest events show first.
      .sort({ last_event_at: -1, created_at: -1 })
      // Return at most 50 items and keep payload light.
      .limit(50)
      .toArray();

    // Fetch the name of the person who performed the action in one query and map by actor id.
    const actorIds = [...new Set(rawItems.map((x) => x.actor_user_id).filter(id => id))];
    const actorDocs = actorIds.length
      ? await usersCol
        .find(
          { user_id: { $in: actorIds } },
          { projection: { _id: 0, user_id: 1, user_name: 1, email: 1 } },
        )
        .toArray()
      : [];

    const actorMap = new Map(
      actorDocs.map((doc) => [doc.user_id, String(doc.user_name || doc.email || "Someone")]),
    );

    // Build API response fields used by the notifications UI.
    // We resolve the user who performed the action's name here (instead of storing it per row)
    // to avoid stale names and reduce storage duplication.
    const items = rawItems.map((item) => ({
      ...item,
      actor_user_name: actorMap.get(item.actor_user_id) || "Someone",
      created_at: item.last_event_at || item.created_at,
      // Always force event_count to a number so the UI can safely show "(Nx)" for collapsed events.
      // This prevents frontend bugs when count is missing, null, or not numeric.
      event_count: Number(item.event_count || 1),
    }));

    // Separate unread count is used for the notification badge/dot.
    const unread_count = await notificationsCol.countDocuments({
      recipient_user_id: authenticatedUserId,
      is_read: false,
    });

    return NextResponse.json({ items, unread_count }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to load notifications", detail: String(err) },
      { status: 500 },
    );
  }
}
