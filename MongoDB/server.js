require('dotenv').config();
const mongoose = require('mongoose');

// Import the Express app (NO app.listen here)
const app = require('./test_routes_controllers');

const MONGO_URI = process.env.MONGODB_URI_TEST

async function connectTestDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Test MongoDB connected");
  } catch (err) {
    console.error("Failed to connect to test DB", err);
    process.exit(1);
  }
}

module.exports = { app, connectTestDB };