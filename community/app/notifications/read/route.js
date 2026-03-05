import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import jwt from "jsonwebtoken";
// Use shared cleanup/index helpers so all notification endpoints behave the same.
import { ensureNotificationIndexes, trimNotificationRetention } from "@/lib/notifications/notifications.js";

export const runtime = "nodejs";

const NOTIFICATIONS_COLLECTION = "community.notifications";

function getAuthenticatedUserId(req) {
  let token = null;

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
      token = parts[1];
    }
  }

  if (!token) {
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
      const cookies = Object.fromEntries(
        cookieHeader.split("; ").map((c) => {
          const [key, ...v] = c.split("=");
          return [key, v.join("=")];
        }),
      );
      token = cookies.access_token;
    }
  }

  // Reject unauthenticated requests.
  if (!token) throw new Error("Missing authentication token");

  const decoded = jwt.decode(token);
  if (!decoded || !decoded.sub) throw new Error("Invalid token payload");
  return decoded.sub;
}

export async function POST(req) {
  try {
    let authenticatedUserId;
    try {
      authenticatedUserId = getAuthenticatedUserId(req);
    } catch (authErr) {
      return NextResponse.json(
        { error: "Unauthorized", detail: String(authErr) },
        { status: 401 },
      );
    }

    // Parse body safely and normalize accepted selectors.
    const body = await req.json().catch(() => ({}));
    const markAll = body?.mark_all === true;
    const postId = typeof body?.post_id === "string" ? body.post_id.trim() : "";
    const notificationIds = Array.isArray(body?.notification_ids)
      ? body.notification_ids.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim())
      : [];

    // Caller must provide either mark_all, a post id, or notification ids.
    if (!markAll && !postId && notificationIds.length === 0) {
      return NextResponse.json(
        { error: "Provide mark_all, post_id, or notification_ids" },
        { status: 400 },
      );
    }

    // Scope updates to this user and only unread notifications.
    const filter = {
      recipient_user_id: authenticatedUserId,
      is_read: false,
    };

    if (markAll) {
      // Keep base filter only (recipient + unread).
    } else if (postId) {
      filter.post_id = postId;
    } else {
      filter.notification_id = { $in: notificationIds };
    }

    const db = await getDb();
    try {
      await ensureNotificationIndexes(db);
    } catch (err) {
      console.warn("[notifications] index ensure failed on read:", String(err));
    }

    // Delete old notifications (older than 30 days via helper config)
    // so storage stays bounded and stale rows don't accumulate.
    try {
      await trimNotificationRetention(db);
    } catch (err) {
      console.warn("[notifications] retention trim failed on read:", String(err));
    }

    // Mark matched rows as read and stamp read timestamp.
    const result = await db.collection(NOTIFICATIONS_COLLECTION).updateMany(
      filter,
      // Mark matched notifications as read.
      { $set: { is_read: true, read_at: new Date() } },
    );

    // Return how many unread rows were changed.
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
}
