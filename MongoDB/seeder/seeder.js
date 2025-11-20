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

    // Clear existing
    await User.deleteMany({});
    await Image.deleteMany({});
    await Post.deleteMany({});
    await Comment.deleteMany({});

    // USER
    const user = await User.create({
      user_id: "1001",
      is_admin: false,
      user_name: "alice",
      email: "alice@example.com",
      password: "TestingPassword", // for dev only; real app should hash
      age: 27,
      created_at: new Date(),
    });

    console.log("User inserted:", user.user_id);

    // IMAGE
    const image = await Image.create({
      image_id: "50001",
      user_id: "1001",
      s3_key: "uploads/2025/10/31/alice-50001.jpg",
      is_ai: true,
      likelihood: 82,
    });

    console.log("Image inserted:", image.image_id);

    // POST
    const post = await Post.create({
      post_id: "9001",
      user_id: "1001",
      image_id: "50001",
      description: "My first AI-generated image!",
      result: 82,
      likedBy: ["1002", "1003"],
      clicks_count: 34,
      up_vote_count: 20,
      down_vote_count: 2,
    });

    console.log("Post inserted:", post.post_id);

    // COMMENT
    const comment = await Comment.create({
      comment_id: "2001",
      post_id: "9001",
      user_id: "1002",
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
