const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    image_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Owner of the image (we cannot rely on posts for this,
    // because history can exist without a community post)
    user_id: {
      type: String,
      required: true,
      index: true,
    },

    s3_key: {
      type: String,
      required: true,
      minlength: 1,
    },

    // Snapshot of detector result
    is_ai: {
      type: Boolean,
      required: true,
    },

    score: {
      type: Number,
      min: 0,
      max: 1,
      required: true,
    },

    likelihood: {
      type: Number,
      min: 0,
      max: 100,
      required: true,
    },

    // Whether this image is publicly accessible
    // Community service can instruct media to flip this when a post is created/removed.
    is_public: {
      type: Boolean,
      default: false,
    },

    uploaded_at: {
      type: Date,
      required: true,
      default: Date.now,
    },

    is_reported: {
      type: Boolean,
      default: false,
    },
  },
  { collection: "media.images" }
);

module.exports = mongoose.model("Image", imageSchema);