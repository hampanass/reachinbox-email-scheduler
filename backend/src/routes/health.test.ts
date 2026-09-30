import assert from "node:assert/strict";
import session from "express-session";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { createApp } from "../app.js";
import { prisma } from "../db/prisma.js";
import { emailQueue } from "../queue/emailQueue.js";
import { redisConnection } from "../queue/redis.js";

let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp({
    sessionSecret: "test-session-secret-that-is-at-least-32-characters",
    sessionStore: new session.MemoryStore(),
  }).listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await emailQueue.close();
  await prisma.$disconnect();
  await redisConnection.quit();
});

test("GET /api/health/db reports PostgreSQL connectivity", async () => {
  const response = await fetch(`${baseUrl}/api/health/db`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    database: "connected",
  });
});

test("GET /admin/queues serves the local Bull Board without authentication", async () => {
  const response = await fetch(`${baseUrl}/admin/queues`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
});