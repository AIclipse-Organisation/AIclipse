const mongoose = require("mongoose");
require("dotenv").config();

const User = require("../mongo-models/auth.users.model");
const Image = require("../mongo-models/media.images.model");
const Post = require("../mongo-models/community.posts.model");
const Comment = require("../mongo-models/community.comments.model");

async function runSeeder() {
  try {
    await mongoose.connect(
      process.env.MONGO_URI || "mongodb://localhost:27017/app"
    );

    console.log("Connected to MongoDB");

    // Clear existing data in these collections
    await User.deleteMany({});
    await Image.deleteMany({});
    await Post.deleteMany({});
    await Comment.deleteMany({});

    // --------------------
    // USERS
    // --------------------
    const user1 = await User.create({
      user_id: "1001",
      is_admin: false,
      user_name: "alice",
      email: "alice@example.com",
      password: "TestingPassword", 
      age: 27,
      created_at: new Date(),
    });

    const user2 = await User.create({
      user_id: "1002",
      is_admin: false,
      user_name: "bob",
      email: "bob@example.com",
      password: "AnotherTestingPassword",
      age: 30,
      created_at: new Date(),
    });

    console.log("Users inserted:", user1.user_id, user2.user_id);

    // --------------------
    // IMAGE 
    // --------------------
    const image = await Image.create({
      image_id: "50001",
      user_id: user1.user_id,
      s3_key: "uploads/2025/10/31/alice-50001.jpg",
      is_ai: true,
      score: 0.82,      
      likelihood: 82,   

      is_public: true,  
    });

    console.log("Image inserted:", image.image_id);

    // --------------------
    // POST
    // --------------------
    const post = await Post.create({
      post_id: "9001",
      user_id: user1.user_id,
      image_id: image.image_id,
      description: "My first AI-generated image!",
      clicks_count: 34,
      up_vote_count: 20,
      down_vote_count: 2,
      controversial_since: null,
      is_reported: false,
    });

    console.log("Post inserted:", post.post_id);

    // --------------------
    // COMMENT
    // --------------------
    const comment = await Comment.create({
      comment_id: "2001",
      post_id: post.post_id,          
      parent_comment_id: null,        
      user_id: user2.user_id,         
      text: "This is awesome!",
      
    });

    console.log("Comment inserted:", comment.comment_id);

    console.log("All seed data inserted!");
    process.exit(0);
  } catch (err) {
    console.error("SEED ERROR:", err);
    process.exit(1);
  }
}

runSeeder();
