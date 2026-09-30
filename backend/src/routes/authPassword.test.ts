import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import session from "express-session";
import { Passport } from "passport";
import { after, before, test } from "node:test";
import type { PrismaClient, User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createAuthRouter } from "./auth.js";
import { createPasswordAuthRouter } from "./authPassword.js";

const users = new Map<string, User>();
let server: Server;
let baseUrl: string;

const prisma = {
  user: {
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
      [...users.values()].find((user) => (where.id && user.id === where.id) || (where.email && user.email === where.email)) ?? null,
    create: async ({ data }: { data: { email: string; passwordHash: string; name: string | null } }) => {
      if (users.has(data.email)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
      const user = {
        id: `user-${users.size + 1}`,
        email: data.email,
        name: data.name,
        passwordHash: data.passwordHash,
        googleId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as User;
      users.set(user.email, user);
      return user;
    },
  },
} as unknown as PrismaClient;

before(async () => {
  const seededHash = await bcrypt.hash("correct-password-123", 4);
  const googleOnlyUser = {
    id: "google-only-user",
    email: "google@example.test",
    name: "Google User",
    passwordHash: null,
    googleId: "google-subject",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
  const standardUser = {
    ...googleOnlyUser,
    id: "password-user",
    email: "password@example.test",
    passwordHash: seededHash,
    googleId: null,
  } as User;
  users.set(googleOnlyUser.email, googleOnlyUser);
  users.set(standardUser.email, standardUser);

  const passport = new Passport();
  passport.serializeUser((user: Express.User, done) => done(null, user.id));
  passport.deserializeUser((id: string, done) => {
    done(null, [...users.values()].find((user) => user.id === id) ?? false);
  });

  const app = express();
  app.use(express.json());
  app.use(session({
    name: "test.sid",
    secret: "test-session-secret-that-is-at-least-32-characters",
    store: new session.MemoryStore(),
    resave: false,
    saveUninitialized: false,
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use("/auth", createPasswordAuthRouter(prisma));
  app.use("/auth", createAuthRouter(passport, false));

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

async function request(path: string, payload?: object, cookie?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: payload ? "POST" : "GET",
    headers: {
      ...(payload ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  return response;
}

test("registration hashes password and creates an authenticated safe session", async () => {
  const response = await request("/auth/register", {
    email: "  New.User@example.test ",
    password: "strong-password-123",
    name: "New User",
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { user: Record<string, unknown> };
  assert.deepEqual(body.user, { id: "user-3", email: "new.user@example.test", name: "New User" });
  assert.equal("passwordHash" in body.user, false);

  const stored = users.get("new.user@example.test");
  assert.ok(stored?.passwordHash);
  assert.notEqual(stored.passwordHash, "strong-password-123");
  assert.equal(await bcrypt.compare("strong-password-123", stored.passwordHash), true);

  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const sessionResponse = await request("/auth/me", undefined, cookie);
  assert.equal(sessionResponse.status, 200);
  assert.equal((await sessionResponse.json() as { user: { email: string } }).user.email, "new.user@example.test");
});

test("duplicate email registration returns a safe conflict", async () => {
  const response = await request("/auth/register", {
    email: "new.user@example.test",
    password: "different-password",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "An account with this email already exists. Try signing in instead.",
  });
});

test("valid password login creates the same authenticated session and excludes hashes", async () => {
  const response = await request("/auth/login", {
    email: " PASSWORD@example.test ",
    password: "correct-password-123",
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { user: Record<string, unknown> };
  assert.deepEqual(body.user, { id: "password-user", email: "password@example.test", name: "Google User" });
  assert.equal("passwordHash" in body.user, false);

  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const sessionResponse = await request("/auth/me", undefined, cookie);
  assert.equal(sessionResponse.status, 200);
});

test("invalid password and Google-only password login use safe errors", async () => {
  const invalid = await request("/auth/login", {
    email: "password@example.test",
    password: "wrong-password",
  });
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: "Invalid email or password." });

  const googleOnly = await request("/auth/login", {
    email: "google@example.test",
    password: "password-for-google-account",
  });
  assert.equal(googleOnly.status, 401);
  assert.deepEqual(await googleOnly.json(), { error: "Invalid email or password." });
});
