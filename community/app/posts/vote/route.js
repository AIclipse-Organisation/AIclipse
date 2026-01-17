import { NextResponse } from "next/server";
import { MongoClient } from "mongodb";

export const runtime = "nodejs"; 

const MONGO_URI = process.env.MONGO_URI || "";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";

const POSTS_COLLECTION = "community.posts";
const VOTES_COLLECTION = "community.votes";


export async function POST(req) {
  let client = null;

  try {
    const body = await req.json().catch(() => null);

    const post_id = body?.post_id || null;
    const user_id = body?.user_id || null;
    const vote = body?.vote || null; 

    // basic validation
    if (!post_id || !user_id || (vote !== "up" && vote !== "down")) {
      return NextResponse.json(
        { error: "Missing/invalid fields: post_id, user_id, vote('up'|'down')" },
        { status: 400 }
      );
    }

    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not set");
    }

    // connect to Mongo 
    client = new MongoClient(MONGO_URI);
    await client.connect();

    const db = client.db(MONGO_DB);
    const posts = db.collection(POSTS_COLLECTION);
    const votes = db.collection(VOTES_COLLECTION);

    // ensure unique vote 
    await votes.createIndex(
      { post_id: 1, user_id: 1 },
      { unique: true, name: "uniq_post_user_vote" }
    );

    // make sure post exists
    const postExists = await posts.findOne(
      { post_id },
      { projection: { _id: 0, post_id: 1 } }
    );
    if (!postExists) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // see if this user already voted on this post
    const existing = await votes.findOne(
      { post_id, user_id },
      { projection: { _id: 0, vote: 1 } }
    );

    // same vote again -> don’t change counts , instead just return current counts and update the database
    if (existing?.vote === vote) {
      const post = await posts.findOne(
        { post_id },
        { projection: { _id: 0, up_vote_count: 1, down_vote_count: 1 } }
      );

      return NextResponse.json(
        {
          post_id,
          up_vote_count: Number(post?.up_vote_count ?? 0),
          down_vote_count: Number(post?.down_vote_count ?? 0),
          message: "Vote already recorded",
        },
        { status: 200 }
      );
    }

    // first vote ever, insert vote record + increment the correct counter
    if (!existing) {
      await votes.insertOne({
        post_id,
        user_id,
        vote,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const inc = vote === "up" ? { up_vote_count: 1 } : { down_vote_count: 1 };

      const updated = await posts.findOneAndUpdate(
        { post_id },
        { $inc: inc }, 
        {
          returnDocument: "after",
          projection: { _id: 0, up_vote_count: 1, down_vote_count: 1 },
        }
      );

      return NextResponse.json(
        {
          post_id,
          up_vote_count: Number(updated?.value?.up_vote_count ?? 0),
          down_vote_count: Number(updated?.value?.down_vote_count ?? 0),
        },
        { status: 200 }
      );
    }


    // If they change their mind and switch vote (up <-> down) , will update their existing vote record 
    await votes.updateOne(
      { post_id, user_id },
      { $set: { vote, updated_at: new Date() } }
    );

    // move one count from the old bucket to the new one
    const inc = vote === "up"
      ? { up_vote_count: 1, down_vote_count: -1 }
      : { up_vote_count: -1, down_vote_count: 1 };

    await posts.updateOne({ post_id }, { $inc: inc });

    //  stop counts from going negative
    await posts.updateOne(
      { post_id },
      [
        {
          $set: {
            up_vote_count: { $max: [0, "$up_vote_count"] },
            down_vote_count: { $max: [0, "$down_vote_count"] },
          },
        },
      ]
    );

    // return current authoritative counts
    const post = await posts.findOne(
      { post_id },
      { projection: { _id: 0, up_vote_count: 1, down_vote_count: 1 } }
    );

    return NextResponse.json(
      {
        post_id,
        up_vote_count: Number(post?.up_vote_count ?? 0),
        down_vote_count: Number(post?.down_vote_count ?? 0),
      },
      { status: 200 }
    );
  } catch (err) {
 
    return NextResponse.json(
      { error: "Failed to vote", detail: String(err) },
      { status: 500 }
    );
  } finally {
 
    if (client) {
      try { await client.close(); } catch {}
    }
  }
}
