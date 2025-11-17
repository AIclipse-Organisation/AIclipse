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
      match: /^.+@.+\..+$/,
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
    Age: {
      type: Number,
      min: 18,
    },
    Total_Guesses: {
      type: Number,
      min: 0,
      default: 0,
    },// part of calucating user accuracy 
    Total_Correct: {
      type: Number,
      min: 0,
      default: 0,
    },// part of calucating user accuracy 
    strikes: {
      type: Number,
      min: 0,
      default: 0,
    },// number of reports that were true
    is_blacklisted: {
      type: Boolean,
      default: false,
    },// if so we restrict their perms? 
    plan: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { collection: "users" }
);

module.exports = mongoose.model("User", userSchema);
