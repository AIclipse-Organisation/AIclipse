const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    image_id: {
      type: String,
      unique: true,
      index: true,
    },
    user_id: {
      type: String,
      required: true,
    },
    s3_key: {
      type: String,
      required: true,
      minlength: 1,
    },
    is_ai: {
      type: Boolean,
      default: false,
    },
    is_public: {
      type: Boolean,
      default: false,
    },
    likelihood: {
      type: Number,
      min: 1,
      max: 99,
    },
    uploaded_at: {
      type: Date,
      default: Date.now,
    },
    is_reported: {
      type: Boolean,
      default: false,
    },
  },
  { collection: "images" }
);

module.exports = mongoose.model("Image", imageSchema);
