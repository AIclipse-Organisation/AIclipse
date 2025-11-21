const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    image_id: {
      type: String,
      unique: true,
      index: true,
    },

    //dont need user_id here since we can get it from posts
    
    s3_key: {
      type: String,
      required: true,
      minlength: 1,
    },
    
  },
  { collection: "media.images" }
);

module.exports = mongoose.model("Image", imageSchema);
