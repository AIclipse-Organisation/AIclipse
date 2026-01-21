/**
 * Database Index Initialization Script
 * 
 * Run this script once to create all necessary indexes for the community service.
 * This should be executed during deployment or database migration, not on every request.
 * 
 * Usage:
 *   node scripts/init-db-indexes.js
 * 
 * Required environment variables:
 *   MONGO_URI - MongoDB connection string
 *   MONGO_DB - Database name (default: aiclipse)
 */

const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const MONGO_DB = process.env.MONGO_DB || "aiclipse";

const POSTS_COLLECTION = "community.posts";
const COMMENTS_COLLECTION = "community.comments";
const VOTES_COLLECTION = "community.votes";
const CLICKS_COLLECTION = "community.clicks";

async function createIndexes() {
  let client = null;

  try {

    
    client = new MongoClient(MONGO_URI);
    await client.connect();
 

    const db = client.db(MONGO_DB);

    // Comments Collection Indexes

    const commentsCol = db.collection(COMMENTS_COLLECTION);
    
    await commentsCol.createIndex(
      { post_id: 1, created_at: -1 },
      { name: "by_post_created" }
    );

    
    await commentsCol.createIndex(
      { user_id: 1, created_at: -1 },
      { name: "by_user_created" }
    );


    // Votes Collection Indexes

    const votesCol = db.collection(VOTES_COLLECTION);
    
    await votesCol.createIndex(
      { post_id: 1, user_id: 1 },
      { unique: true, name: "uniq_post_user_vote" }
    );


    // Posts Collection Indexes (optional, add if needed)

    const postsCol = db.collection(POSTS_COLLECTION);
    
    await postsCol.createIndex(
      { post_id: 1 },
      { unique: true, name: "uniq_post_id" }
    );

    
    await postsCol.createIndex(
      { created_at: -1 },
      { name: "by_created_at" }
    );


    // Clicks Collection Indexes (for rate limiting)
    const clicksCol = db.collection(CLICKS_COLLECTION);
    
    await clicksCol.createIndex(
      { post_id: 1, user_id: 1 },
      { unique: true, name: "uniq_post_user_click" }
    );

    
    await clicksCol.createIndex(
      { clicked_at: 1 },
      { name: "by_clicked_at", expireAfterSeconds: 86400 } // Auto-delete after 24 hours
    );

    
    // List all indexes for verification

    const commentIndexes = await commentsCol.indexes();
    commentIndexes.forEach(idx => console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`));
    
    console.log("\nVotes indexes:");
    const voteIndexes = await votesCol.indexes();
    voteIndexes.forEach(idx => console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`));
    
    console.log("\nPosts indexes:");
    const postIndexes = await postsCol.indexes();
    postIndexes.forEach(idx => console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`));

    console.log("\nClicks indexes:");
    const clickIndexes = await clicksCol.indexes();
    clickIndexes.forEach(idx => console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`));

  } catch (err) {
    console.error("\n❌ Error creating indexes:");
    console.error(err);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log("\nConnection closed.");
    }
  }
}

// Run the script
createIndexes();
