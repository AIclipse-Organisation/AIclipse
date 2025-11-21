const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {

    comment_id: {   // Id for the comment
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    parent_post_id: { // Id for the post this comment belongs to
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
