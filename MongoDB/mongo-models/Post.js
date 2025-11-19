const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    post_id: {
      type: String,
      index: true,
      unique: true,
    },  // Added unique index to each post
   
    user_id: {
      type: String,
      required: true,
    }, // ID of the user who created the post
   
    image_id: {
      type: String,
      required: true,
    }, // ID of the associated image
   
    results: {
      type: Number,
      min: 1,
      max: 99
    }, //Results that out algorithm gave for the image in this post
   
    description: {
      type: String,
      required: true,
      minlength: 1,
    },// further datails on the image etc
    
    like_count: 
      {
        type: Number,
        min: 0,
        default: 0
      }
    ,//and count of how many liked the post
    
    comments_id: 
    [
      {
        type: String,
      }
    ]
    ,// Array of comments ids that others made on this post 
    
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

    controversial_since:{
      type: Number ,
      min:0 ,
      default: null,
    },
    
    created_at: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { collection: "posts" }
);

module.exports = mongoose.model("Post", postSchema);
