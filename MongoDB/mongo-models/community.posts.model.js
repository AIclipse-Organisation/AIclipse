const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    post_id: {
      type: String,
      index: true,
      unique: true,
    }, // unique id for each post

    user_id: {
      type: String,
      required: true,
    }, // ID of the user who created the post

    image_id: {
      type: String,
      required: true,
    }, // ID of the associated image

    // Detector result / score for the image in this post
    result: {
      type: Number,
      min: 1,
      max: 99,
    },

    description: {
      type: String,
      required: true,
      minlength: 1,
      trim: true,
    },

    // Who liked the post (user_ids)
    likedBy: [
      {
        type: String,
      },
    ],


    clicks_count: {
      type: Number,
      min: 0,
      default: 0,
    },

    up_vote_count: {
      type: Number,
      min: 0,
      default: 0,
    },

    down_vote_count: {
      type: Number,
      min: 0,
      default: 0,
    },

    controversial_since: {
      type: Number,
      default: null,
    },

    created_at: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { collection: "community.posts" }
);

module.exports = mongoose.model("Post", postSchema);
