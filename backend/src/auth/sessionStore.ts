import "dotenv/config";
import { createClient } from "redis";
import { RedisStore } from "connect-redis";

export const sessionRedisClient = createClient({
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
});

sessionRedisClient.on("error", (error: Error) => {
  console.error("Redis session-store error:", error.message);
});

export const sessionStore = new RedisStore({
  client: sessionRedisClient,
  prefix: "reachinbox:sess:",
});

export async function connectSessionStore(): Promise<void> {
  if (!sessionRedisClient.isOpen) await sessionRedisClient.connect();
}
