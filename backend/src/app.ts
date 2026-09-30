import cors from "cors";
import express from "express";
import session, { type Store } from "express-session";
import passport from "passport";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "./queue/emailQueue.js";
import { prisma } from "./db/prisma.js";
import { createCampaignsRouter } from "./routes/campaigns.js";
import { healthRouter } from "./routes/health.js";
import { createSearchRouter } from "./routes/search.js";
import { searchEmails } from "./services/emailSearch.js";
import { configurePassport } from "./auth/passport.js";
import { sessionStore } from "./auth/sessionStore.js";
import { createAuthRouter } from "./routes/auth.js";
import { createSlackOAuthRouter } from "./routes/slackOAuth.js";
import { createPasswordAuthRouter } from "./routes/authPassword.js";
import { createEmailsRouter } from "./routes/emails.js";

const googleOAuthEnabled = configurePassport(passport, prisma);

export function createApp(options: { sessionSecret?: string; sessionStore?: Store } = {}) {
  const sessionSecret = options.sessionSecret ?? process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters");
  }

  const app = express();

  app.use(cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
    credentials: true,
  }));
  app.use(express.json());
  app.use(session({
    name: "reachinbox.sid",
    secret: sessionSecret,
    store: options.sessionStore ?? sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1_000,
    },
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter: boardAdapter,
  });

  app.use("/admin/queues", boardAdapter.getRouter());
  app.use("/auth", createAuthRouter(passport, googleOAuthEnabled));
  app.use("/auth", createPasswordAuthRouter(prisma));
  app.use("/auth", createSlackOAuthRouter({ prisma }));
  app.use("/api/health", healthRouter);
  app.use("/api/campaigns", createCampaignsRouter({ prisma, queue: emailQueue }));
  app.use("/api/emails", createEmailsRouter(prisma));
  app.use("/api/search", createSearchRouter(searchEmails));

  app.get("/", (_request, response) => {
    response.json({ message: "ReachInbox backend is running" });
  });

  return app;
}