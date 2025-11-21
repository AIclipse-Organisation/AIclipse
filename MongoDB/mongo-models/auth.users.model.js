const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    user_id: {
      type: String,
      unique: true,
      index: true,
    },
    is_admin: {
      type: Boolean,
      default: false,
    },
    user_name: {
      type: String,
      required: true,
      minlength: 1,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    created_at: {
      type: Date,
      required: true,
      default: Date.now,
    },
    age: {
      type: Number,
      min: 18,
      max : 100,
    },
    total_guesses: {
      type: Number,
      min: 0,
      default: 0,
    },
    total_correct: {
      type: Number,
      min: 0,
      default: 0,
    },

    //leave strikes, is_blacklisted and plan for future use

  },
  { collection: "auth.users" }
);

module.exports = mongoose.model("User", userSchema);
