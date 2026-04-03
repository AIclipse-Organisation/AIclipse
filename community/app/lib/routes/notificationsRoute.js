import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import {
  ensureNotificationIndexes,
  trimNotificationRetention,
  capNotificationsForUser,
} from "@/lib/notifications/notifications.js";

const NOTIFICATIONS_COLLECTION = "community.notifications";
const USERS_COLLECTION = "auth.users";

function unauthorized(error) {
  return NextResponse.json(
    { error: "Unauthorized", detail: String(error) },
    { status: 401 },
  );
}

export function createNotificationsListHandler({ requireUser }) {
  return async function GET(req) {
    let currentUser;
    try {
      currentUser = await requireUser(req);
    } catch (authErr) {
      return unauthorized(authErr);
    }
    const authenticatedUserId = currentUser.user_id;

    try {
      const { searchParams } = new URL(req.url);
      const unreadOnly = String(searchParams.get("unread_only") || "").toLowerCase() === "true";

      const db = await getDb();

      try {
        await ensureNotificationIndexes(db);
      } catch (err) {
        console.warn("[notifications] index ensure failed on list:", String(err));
      }
      try {
        await trimNotificationRetention(db);
      } catch (err) {
        console.warn("[notifications] retention trim failed on list:", String(err));
      }
      try {
        await capNotificationsForUser(db, authenticatedUserId, 50);
      } catch (err) {
        console.warn("[notifications] cap enforcement failed on list:", String(err));
      }

      const notificationsCol = db.collection(NOTIFICATIONS_COLLECTION);
      const usersCol = db.collection(USERS_COLLECTION);

      const filter = { recipient_user_id: authenticatedUserId };
      if (unreadOnly) {
        filter.is_read = false;
      }

      const rawItems = await notificationsCol
        .find(filter, { projection: { _id: 0 } })
        .sort({ last_event_at: -1, created_at: -1 })
        .limit(50)
        .toArray();

      const actorIds = [...new Set(rawItems.map((x) => x.actor_user_id).filter((id) => id))];
      const actorDocs = actorIds.length
        ? await usersCol
            .find(
              { user_id: { $in: actorIds } },
              { projection: { _id: 0, user_id: 1, user_name: 1, email: 1 } },
            )
            .toArray()
        : [];

      const actorMap = new Map(
        actorDocs.map((doc) => [
          doc.user_id,
          String(doc.user_name || doc.email || "Someone"),
        ]),
      );

      const items = rawItems.map((item) => ({
        ...item,
        actor_user_name: actorMap.get(item.actor_user_id) || "Someone",
        created_at: item.last_event_at || item.created_at,
        event_count: Number(item.event_count || 1),
      }));

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
  };
}

export function createNotificationsUnreadCountHandler({ requireUser }) {
  return async function GET(req) {
    let currentUser;
    try {
      currentUser = await requireUser(req);
    } catch (authErr) {
      return unauthorized(authErr);
    }
    const authenticatedUserId = currentUser.user_id;

    try {
      const db = await getDb();

      try {
        await ensureNotificationIndexes(db);
      } catch (err) {
        console.warn("[notifications] index ensure failed on unread-count:", String(err));
      }
      try {
        await trimNotificationRetention(db);
      } catch (err) {
        console.warn("[notifications] retention trim failed on unread-count:", String(err));
      }

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
  };
}

export function createNotificationsReadHandler({ requireUser }) {
  return async function POST(req) {
    let currentUser;
    try {
      currentUser = await requireUser(req);
    } catch (authErr) {
      return unauthorized(authErr);
    }
    const authenticatedUserId = currentUser.user_id;

    try {
      const body = await req.json().catch(() => ({}));
      const markAll = body?.mark_all === true;
      const postId = typeof body?.post_id === "string" ? body.post_id.trim() : "";
      const notificationIds = Array.isArray(body?.notification_ids)
        ? body.notification_ids
            .filter((value) => typeof value === "string" && value.trim())
            .map((value) => value.trim())
        : [];

      if (!markAll && !postId && notificationIds.length === 0) {
        return NextResponse.json(
          { error: "Provide mark_all, post_id, or notification_ids" },
          { status: 400 },
        );
      }

      const filter = {
        recipient_user_id: authenticatedUserId,
        is_read: false,
      };

      if (!markAll) {
        if (postId) {
          filter.post_id = postId;
        } else {
          filter.notification_id = { $in: notificationIds };
        }
      }

      const db = await getDb();
      try {
        await ensureNotificationIndexes(db);
      } catch (err) {
        console.warn("[notifications] index ensure failed on read:", String(err));
      }
      try {
        await trimNotificationRetention(db);
      } catch (err) {
        console.warn("[notifications] retention trim failed on read:", String(err));
      }

      const result = await db.collection(NOTIFICATIONS_COLLECTION).updateMany(
        filter,
        { $set: { is_read: true, read_at: new Date() } },
      );

      return NextResponse.json(
        { ok: true, modified_count: Number(result.modifiedCount || 0) },
        { status: 200 },
      );
    } catch (err) {
      return NextResponse.json(
        { error: "Failed to mark notifications read", detail: String(err) },
        { status: 500 },
      );
    }
  };
}
