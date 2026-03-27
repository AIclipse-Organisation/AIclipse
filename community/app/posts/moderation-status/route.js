import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";

export const runtime = "nodejs";

const POSTS_COLLECTION = "community.posts";

// POST /community/posts/moderation-status
// body: { image_ids: ["img_123", "img_456"] }
// Returns moderation status for each image
export async function POST(req) {
    try {
        const body = await req.json().catch(() => null);
        const image_ids = body?.image_ids || [];

        if (!Array.isArray(image_ids) || image_ids.length === 0) {
            return NextResponse.json({ items: [] }, { status: 200 });
        }

        const db = await getDb();
        const postsCol = db.collection(POSTS_COLLECTION);

        // Find all removed posts for these images
        const removedPosts = await postsCol
            .find({
                image_id: { $in: image_ids },
                is_removed: true,
                moderation_status: "removed"
            })
            .toArray();

        // Build response with moderation info
        const items = removedPosts.map(post => {
            const lastLog = post.moderation_log?.[post.moderation_log.length - 1];
            return {
                image_id: post.image_id,
                moderation_status: post.moderation_status,
                moderation_reason: lastLog?.note || "Removed by moderation"
            };
        });

        return NextResponse.json({ items }, { status: 200 });
    } catch (err) {
        console.error("Error fetching moderation status:", err);
        return NextResponse.json(
            { error: "Failed to fetch moderation status", detail: String(err) },
            { status: 500 }
        );
    }
}
