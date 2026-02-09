import Redis from "ioredis";

const host = process.env.REDIS_HOST;
const port = Number(process.env.REDIS_PORT);
const password = process.env.REDIS_PASSWORD;

const getRedisClient = () => {
  const client = new Redis({
    host,
    port,
    password,
    maxRetriesPerRequest: 5,
    enableReadyCheck: true,
  });

  client.on("error", (err) => {
    console.error("[redis] error:", err?.message || err);
  });

  return client;
};

// Use global variable to preserve connection across module redoplyoments in dev . speeds up rebuilding
// in development mode.
let redis;

if (process.env.APP_ENV === "dev") {
  redis = getRedisClient();
} else {
  if (!global.redis) {
    global.redis = getRedisClient();
  }
  redis = global.redis;
}

export function getRedis() {
  return redis;
}