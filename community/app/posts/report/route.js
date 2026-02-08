import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo/mongo.js";
import { validatePostId } from "../validation.js";

export const runtime = "nodejs";

const POSTS_COLLECTION = "community.posts";

//  POST /community/posts/report
//  body: { post_id }
//  Marks a post as reported.
//  reporting twice does nothing extra.

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const post_id = body?.post_id || null;

    if (!post_id) {
      return NextResponse.json({ error: "Missing post_id" }, { status: 400 });
    }

    // validate post_id format
    const postIdValidation = validatePostId(post_id);
    if (!postIdValidation.valid) {
      return NextResponse.json(
        { error: postIdValidation.error },
        { status: 400 }
      );
    }
    const safePostId = postIdValidation.value; // Use sanitized string value

    const db = await getDb();
    const postsCol = db.collection(POSTS_COLLECTION);

    // mark as reported 
    const result = await postsCol.findOneAndUpdate(
      { post_id: safePostId },
      {
        $set: {
          is_reported: true,
          reported_at: new Date(), 
        },
      },
      {
        returnDocument: "after",
        projection: { _id: 0, post_id: 1, is_reported: 1 },
      }
    );

    if (!result.value) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        post_id: safePostId,
        is_reported: true,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to report post", detail: String(err) },
      { status: 500 }
    );
  }
}