import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import jwt from "jsonwebtoken";
// Use shared cleanup/index helpers so this endpoint matches list/read behavior.
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

  // Decode JWT payload and use `sub` as user id.
  const decoded = jwt.decode(token);
  if (!decoded || !decoded.sub) throw new Error("Invalid token payload");
  return decoded.sub;
}

export async function GET(req) {
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
