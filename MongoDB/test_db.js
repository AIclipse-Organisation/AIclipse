require('dotenv').config();
const mongoose = require('mongoose');

// Use dedicated test URI if set, otherwise fall back to main URI
const MONGO_URI = process.env.MONGODB_URI_TEST 

if (!MONGO_URI) {
  throw new Error('Missing MONGODB_URI_TEST or MONGODB_URI in environment');
}

async function connectTestDB() {
  if (mongoose.connection.readyState === 1) {
    // already connected
    return;
  }
  await mongoose.connect(MONGO_URI);
}


async function disconnectTestDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

module.exports = { connectTestDB, disconnectTestDB };
