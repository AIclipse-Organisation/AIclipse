const mongoose = require("mongoose");

const billingSchema = new mongoose.Schema(
  {
    billing_id: {
      type: String,
      unique: true,
      index: true,
    },
    user_id: {
      type: String,
      required: true,
    },
    plan: {
      type: Number,
      required: true,
      min: 0,
    },//what plan the user paid for
    status: {
      type: Boolean,
      required: true,
      default: true,
    },// is the subscription still active
    amount: {
      type: Number,
      required: true,
      min: 0,
    },// amount paid
    created_at: {
      type: Date,
      required: true,
      default: Date.now,
    },
    current_period_start: {
      type: Date,
      required: true,
    },//what date the plan start at
    current_period_end: {
      type: Date,
      required: true,
    },//what date the plan ends at
  },
  { collection: "billing" }
);

module.exports = mongoose.model("Billing", billingSchema);
