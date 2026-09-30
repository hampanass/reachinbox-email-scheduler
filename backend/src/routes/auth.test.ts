import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import session from "express-session";
import { Passport } from "passport";
import { after, before, test } from "node:test";
import { requireAuthenticated } from "../auth/requireAuthenticated.js";
import { createAuthRouter } from "./auth.js";

let server: Server;
let baseUrl: string;

before(async () => {
  const passport = new Passport();
  passport.serializeUser((user: Express.User, done) => done(null, user.id));
  passport.deserializeUser((id: string, done) => {
    done(null, id === "test-user" ? {
      id,
      email: "person@example.test",
      name: "Test Person",
      googleId: "google-test-id",
      passwordHash: null,
    } : false);
  });

  const app = express();
  app.use(session({
    name: "test.sid",
    secret: "test-session-secret-that-is-at-least-32-characters",
    store: new session.MemoryStore(),
    resave: false,
    saveUninitialized: false,
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post("/test-login", (request, response, next) => {
    request.login({ id: "test-user", email: "person@example.test", name: "Test Person" }, (error) => {
      if (error) return next(error);
      response.status(204).end();
    });
  });
  app.get("/protected", requireAuthenticated, (_request, response) => response.json({ ok: true }));
  app.use("/auth", createAuthRouter(passport, false));

  server = app.listen(0);
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
});

test("authentication middleware rejects unauthenticated requests", async () => {
  const response = await fetch(`${baseUrl}/protected`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Authentication required" });
});

test("GET /auth/me reports no user without a session and returns a safe user after login", async () => {
  const anonymous = await fetch(`${baseUrl}/auth/me`);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { authenticated: false, user: null });

  const login = await fetch(`${baseUrl}/test-login`, { method: "POST" });
  assert.equal(login.status, 204);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const authenticated = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), {
    authenticated: true,
    user: { id: "test-user", email: "person@example.test", name: "Test Person" },
  });

  const protectedResponse = await fetch(`${baseUrl}/protected`, { headers: { cookie } });
  assert.equal(protectedResponse.status, 200);
});