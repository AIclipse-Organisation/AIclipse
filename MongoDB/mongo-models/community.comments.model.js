const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    post_id: {
      type: String,
      required: true,
      index: true,
    },

    comment_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    user_id: {
      type: String,
      required: true,
    },

    text: {
      type: String,
      required: true,
      minlength: 1,
      trim: true,
    },

    created_at: {
      type: Date,
      required: true,
      default: Date.now,
    },

    parent_comment_id: {
      type: String,
      default: null,
    },

    up_vote_count: {
      type: Number,
      default: 0,
    },

    down_vote_count: {
      type: Number,
      default: 0,
    },
  },
  { collection: "community.comments" }
);

module.exports = mongoose.model("Comment", commentSchema);
