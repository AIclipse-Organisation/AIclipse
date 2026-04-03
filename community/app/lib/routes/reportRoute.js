import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import { validatePostId } from "@/app/posts/validation.js";
import { recordCollapsedNotification } from "@/lib/notifications/notifications.js";

const POSTS_COLLECTION = "community.posts";

function unauthorized(error) {
  return NextResponse.json(
    { error: "Unauthorized", detail: String(error) },
    { status: 401 },
  );
}

export function createReportRouteHandlers({ requireUser, buildGatewayIdentityHeaders }) {
  return {
    async POST(req) {
      let currentUser;
      try {
        currentUser = await requireUser(req);
      } catch (authErr) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const reporterId = currentUser.user_id;

      try {
        const body = await req.json().catch(() => null);
        const { post_id, reason = "General Flag", details = "" } = body || {};

        if (!post_id) {
          return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
        }

        const validation = validatePostId(post_id);
        if (!validation.valid) {
          return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        const db = await getDb();
        const postsCol = db.collection(POSTS_COLLECTION);
        const result = await postsCol.findOneAndUpdate(
          { post_id: validation.value },
          {
            $set: { is_reported: true, last_reported_at: new Date() },
            $addToSet: { reporter_ids: reporterId },
            $push: {
              report_history: {
                reporter_id: reporterId,
                reason,
                details,
                created_at: new Date(),
              },
            },
            $inc: { report_count: 1 },
          },
          {
            returnDocument: "after",
            projection: { _id: 0, post_id: 1, report_count: 1 },
          },
        );

        const updatedDoc = result?.value !== undefined ? result.value : result;
        if (!updatedDoc) {
          return NextResponse.json({ error: "Post not found in database" }, { status: 404 });
        }

        return NextResponse.json(
          { message: "Post reported successfully", report_count: updatedDoc.report_count },
          { status: 200 },
        );
      } catch (err) {
        return NextResponse.json(
          { error: "Failed to report", detail: String(err) },
          { status: 500 },
        );
      }
    },

    async PATCH(req) {
      let currentUser;
      try {
        currentUser = await requireUser(req);
      } catch (authErr) {
        return unauthorized(authErr);
      }
      if (!currentUser.is_admin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const adminUserId = currentUser.user_id;

      try {
        const { post_id, action, note } = await req.json();

        const db = await getDb();
        const postsCol = db.collection(POSTS_COLLECTION);
        const post = await postsCol.findOne({ post_id });
        if (!post) {
          return NextResponse.json({ error: "Post not found" }, { status: 404 });
        }

        const logEntry = {
          admin_id: adminUserId,
          action,
          note: note || "No note provided",
          timestamp: new Date(),
        };

        const updateDoc = {
          $set: {
            is_reported: false,
            last_moderated_at: new Date(),
          },
          $push: { moderation_log: logEntry },
        };

        if (action === "remove") {
          updateDoc.$set.moderation_status = "removed";
          updateDoc.$set.is_removed = true;

          try {
            const gatewayUri = process.env.GATEWAY_URI;
            await fetch(`${gatewayUri}/image/${post.image_id}`, {
              method: "PATCH",
              headers: buildGatewayIdentityHeaders(currentUser),
              body: JSON.stringify({ is_public: false }),
            });
          } catch (err) {
            console.error("Gateway Sync Failed", err);
          }

          if (post.user_id && post.user_id !== adminUserId) {
            try {
              await recordCollapsedNotification(db, {
                recipient_user_id: post.user_id,
                actor_user_id: adminUserId,
                post_id: post.post_id,
                type: "moderation",
                moderation_action: "removed",
                moderation_reason: note || "Content policy violation",
                image_id: post.image_id || null,
              });
            } catch (notifyErr) {
              console.error("Failed to create moderation notification:", notifyErr);
            }
          }
        } else if (action === "dismiss") {
          updateDoc.$set.moderation_status = "cleared";
          updateDoc.$set.is_removed = false;
        }

        await postsCol.updateOne({ post_id }, updateDoc);
        return NextResponse.json({ message: `Post ${action}ed.` });
      } catch (err) {
        return NextResponse.json(
          { error: "Action failed", detail: String(err) },
          { status: 500 },
        );
      }
    },

    async GET(req) {
      let currentUser;
      try {
        currentUser = await requireUser(req);
      } catch (authErr) {
        return unauthorized(authErr);
      }
      if (!currentUser.is_admin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      try {
        const db = await getDb();
        const postsCol = db.collection(POSTS_COLLECTION);
        const imagesCol = db.collection("images");

        const reportedPosts = await postsCol
          .find({
            is_reported: true,
            is_removed: { $ne: true },
            is_deleted: { $ne: true },
          })
          .sort({ report_count: -1, last_reported_at: -1 })
          .toArray();

        if (reportedPosts.length === 0) {
          return NextResponse.json({ items: [] }, { status: 200 });
        }

        const imageIds = reportedPosts.map((post) => post.image_id).filter((id) => id != null);
        const imageDocs = await imagesCol.find({ image_id: { $in: imageIds } }).toArray();
        const imageMap = {};
        imageDocs.forEach((img) => {
          imageMap[img.image_id] = img.url;
        });

        const items = reportedPosts.map((post) => ({
          ...post,
          url: imageMap[post.image_id] || null,
        }));

        return NextResponse.json({ items }, { status: 200 });
      } catch (err) {
        return NextResponse.json(
          { error: "Failed to fetch reporting queue", detail: String(err) },
          { status: 500 },
        );
      }
    },
  };
}
