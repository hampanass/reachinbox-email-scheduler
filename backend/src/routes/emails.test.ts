import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import session from "express-session";
import { Passport } from "passport";
import { after, before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createEmailsRouter } from "./emails.js";

let server: Server;
let baseUrl: string;
let lastQuery: unknown;

const emailRecord = {
  id: "email-owned",
  recipientEmail: "recipient@example.test",
  status: "SENT",
  scheduledAt: new Date("2030-02-03T04:00:00.000Z"),
  sentAt: new Date("2030-02-03T04:02:00.000Z"),
  campaign: {
    id: "campaign-owned",
    subject: "Actual sent subject",
    body: "The actual message body",
    startAt: new Date("2030-02-03T04:00:00.000Z"),
    createdAt: new Date("2030-02-03T03:00:00.000Z"),
  },
};

const prisma = {
  email: {
    findFirst: async ({ where }: { where: { id: string; campaign: { userId: string } } }) => {
      lastQuery = where;
      return where.id === emailRecord.id && where.campaign.userId === "owner-user" ? emailRecord : null;
    },
  },
} as unknown as PrismaClient;

before(async () => {
  const passport = new Passport();
  passport.serializeUser((user: Express.User, done) => done(null, user.id));
  passport.deserializeUser((id: string, done) => done(null, id === "owner-user"
    ? { id, email: "owner@example.test", name: "Owner" }
    : false));

  const app = express();
  app.use(session({
    name: "email-test.sid",
    secret: "test-session-secret-that-is-at-least-32-characters",
    store: new session.MemoryStore(),
    resave: false,
    saveUninitialized: false,
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post("/test-login", (request, response, next) => {
    request.login({ id: "owner-user", email: "owner@example.test", name: "Owner" }, (error) => {
      if (error) return next(error);
      response.status(204).end();
    });
  });
  app.use("/api/emails", createEmailsRouter(prisma));

  server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("email detail requires authentication", async () => {
  const response = await fetch(`${baseUrl}/api/emails/email-owned`);
  assert.equal(response.status, 401);
});

test("owner receives full email and campaign details without private credentials", async () => {
  const login = await fetch(`${baseUrl}/test-login`, { method: "POST" });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const response = await fetch(`${baseUrl}/api/emails/email-owned`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.recipient, "recipient@example.test");
  assert.equal(payload.subject, "Actual sent subject");
  assert.equal(payload.body, "The actual message body");
  assert.equal(payload.status, "SENT");
  assert.ok(payload.sentAt);
  assert.deepEqual(lastQuery, { id: "email-owned", campaign: { userId: "owner-user" } });
  assert.equal("passwordHash" in payload, false);
  assert.equal("botAccessToken" in payload, false);
});

test("email detail does not reveal another user's email", async () => {
  const login = await fetch(`${baseUrl}/test-login`, { method: "POST" });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const response = await fetch(`${baseUrl}/api/emails/email-owned`, { headers: { cookie } });
  assert.equal(response.status, 200);

  // A different email ID, even if it exists elsewhere, is scoped by the same authenticated campaign owner.
  const otherResponse = await fetch(`${baseUrl}/api/emails/email-other-user`, { headers: { cookie } });
  assert.equal(otherResponse.status, 404);
  assert.deepEqual(await otherResponse.json(), { error: "Email not found" });
});
