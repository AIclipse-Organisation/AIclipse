const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    post_id: {
      type: String,
      index: true,
      unique: true,
      required: true,
    }, 

    user_id: {
      type: String,
      required: true,
    }, 

    image_id: {
      type: String,
      required: true,
    }, // ID of the associated image


    description: {
      type: String,
      required: true,
      minlength: 1,
      trim: true,
    },


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

    is_reported: {
      type: Boolean,
      default: false,
    },

  },
  { collection: "community.posts" }
);

module.exports = mongoose.model("Post", postSchema);
