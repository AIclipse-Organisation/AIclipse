import Redis from "ioredis";

let redis;

export function getRedis() {
  if (redis) return redis;

  const host = process.env.REDIS_HOST || "redis-srv";
  const port = Number(process.env.REDIS_PORT || "6379");
  const password = process.env.REDIS_PASSWORD;

  redis = new Redis({
    host,
    port,
    password,
    maxRetriesPerRequest: 5,
    enableReadyCheck: true,
  });

  redis.on("error", (err) => {
    // Don't crash on transient redis errors; log for debugging
    console.error("[redis] error:", err?.message || err);
  });

  return redis;
}
