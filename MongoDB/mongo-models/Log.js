const mongoose = require("mongoose");

const logSchema = new mongoose.Schema(
  {
    log_id: {
      type: String,
      unique: true,
      index: true,
    },
    image_id: {
      type: String,
    },// which image this log entry is about 
    user_id: {
      type: String,
      required: true,
    },// who did the action
    action: {
      type: String,
      required: true,
    },// What action was performed like a delete/edit
    created_at: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { collection: "logs" }
);

module.exports = mongoose.model("Log", logSchema);
