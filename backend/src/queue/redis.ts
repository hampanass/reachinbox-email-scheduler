import "dotenv/config";
import { Redis } from "ioredis";

export const redisConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

redisConnection.on("error", (error: Error) => {
  console.error("Redis connection error:", error.message);
});