const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {

    comment_id: {   // Id for the comment
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Post this comment belongs to (always required)
    post_id: {
      type: String,
      required: true,
      index: true,
    },

    // For replies: which comment this is replying to (null for top-level comments)
    parent_comment_id: {
      type: String,
      default: null,
    },

    user_id: {  // Id for the user who made the comment
      type: String,
      required: true,
    },

    text: {     // The content of the comment
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