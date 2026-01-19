import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";
import { validateUserId, validatePostId } from "../validation.js";

export const runtime = "nodejs"; // required for MongoDB driver

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";
const POSTS_COLLECTION = "community.posts";
const CLICKS_COLLECTION = "community.clicks";

// Rate limit: only count one click per user per post within this time window
const CLICK_COOLDOWN_MS = 60 * 1000; // 1 minute


export async function POST(req) {
  let client = null;

  try {
    const body = await req.json().catch(() => null);
    const post_id = body?.post_id || null;
    const user_id = body?.user_id || null;

    // basic validation
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

    // validate user_id format if provided
    let safeUserId = null;
    if (user_id) {
      const userIdValidation = validateUserId(user_id);
      if (!userIdValidation.valid) {
        return NextResponse.json(
          { error: userIdValidation.error },
          { status: 400 }
        );
      }
      safeUserId = userIdValidation.value; // Use sanitized string value
    }

    // user_id is optional, but if provided enables rate limiting
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const posts = db.collection(POSTS_COLLECTION);
    const clicks = db.collection(CLICKS_COLLECTION);

    let shouldIncrement = true;

    // If user_id provided, check rate limiting
    if (safeUserId) {
      const now = new Date();
      const cooldownThreshold = new Date(now.getTime() - CLICK_COOLDOWN_MS);

      // Check if user recently clicked this post
      const recentClick = await clicks.findOne({
        post_id: safePostId,
        user_id: safeUserId,
        clicked_at: { $gte: cooldownThreshold }
      });

      if (recentClick) {
        // User clicked too recently, don't increment
        shouldIncrement = false;
      } else {
        // Record this click with upsert to track user's last click time
        await clicks.updateOne(
          { post_id: safePostId, user_id: safeUserId },
          {
            $set: { clicked_at: now },
            $setOnInsert: { created_at: now }
          },
          { upsert: true }
        );
      }
    }

    // Increment click count only if rate limit passed (or no user_id provided)
    let result;
    if (shouldIncrement) {
      result = await posts.findOneAndUpdate(
        { post_id: safePostId },
        { $inc: { clicks_count: 1 } },
        {
          returnDocument: "after",
          projection: { _id: 0, clicks_count: 1 },
        }
      );
    } else {
      // Just fetch current count without incrementing
      result = await posts.findOne(
        { post_id: safePostId },
        { projection: { _id: 0, clicks_count: 1 } }
      );
      result = { value: result };
    }

    if (!result.value) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        post_id,
        clicks_count: result.value.clicks_count,
        counted: shouldIncrement
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to increment clicks",
        detail: String(err),
      },
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {}
    }
  }
}

