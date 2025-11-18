const mongoose = require("mongoose");
require("dotenv").config();

// Load models
const User = require("../mongo-models/User");
const Image = require("../mongo-models/Image");
const Post = require("../mongo-models/Post");
const Comment = require("../mongo-models/Comment");
const Log = require("../mongo-models/Log");
const Billing = require("../mongo-models/Billing");

async function runSeeder() {
  try {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/app");

    console.log("Connected to MongoDB");

        // Clear existing (optional)
    await User.deleteMany({});
    await Image.deleteMany({});
    await Post.deleteMany({});
    await Comment.deleteMany({});
    await Log.deleteMany({});
    await Billing.deleteMany({});

    // Insert seed users
    const user = await User.create({
      user_id: "1001",
      is_admin: false,
      user_name: "alice",
      email: "alice@example.com",
      password: "TestingPassword",
      Age: 27,
      created_at: new Date(),
    });

    console.log("User inserted:", user.user_id);

    const image = await Image.create({
      image_id: "50001",
      user_id: "1001",
      s3_key: "uploads/2025/10/31/alice-50001.jpg",
      is_ai: true,
      likelihood: 82,
    });

    console.log("Image inserted:", image.image_id);

    const post = await Post.create({
      post_id: "9001",
      user_id: "1001",
      image_id: "50001",
      Description: "My first AI-generated image!",
      likedBy: 2,
      comments_id: ["2001", "2002"],
      clicks_count: 34,
      up_vote_count: 20,
      down_vote_count: 2,
    });

    console.log("Post inserted:", post.post_id);

    const comment = await Comment.create({
      comment_id: "2001",
      user_id: "1002",
      text: "This is awesome!",
    });

    console.log("Comment inserted:", comment.comment_id);

    const billing = await Billing.create({
      billing_id: "8001",
      user_id: "1001",
      plan: 2,
      status: true,
      amount: 1499,
      created_at: new Date(),
      current_period_start: new Date("2025-10-01"),
      current_period_end: new Date("2025-10-31"),
    });

    console.log("Billing inserted:", billing.billing_id);

    console.log("All seed data inserted!");
    process.exit(0);
  } catch (err) {
    console.error("SEED ERROR:", err);
    process.exit(1);
  }
}

runSeeder();
