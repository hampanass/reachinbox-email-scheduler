import { Router } from "express";
import type { PrismaClient, User } from "@prisma/client";
import type { Request } from "express";
import { hashPassword, validatePassword, verifyPassword } from "../auth/passwords.js";
import { requireAuthenticated } from "../auth/requireAuthenticated.js";

export type SafeUser = Pick<User, "id" | "email" | "name">;

type AuthRequest = Request & {
  login(user: Express.User, callback: (error: unknown) => void): void;
};

function safeUser(user: User): SafeUser {
  return { id: user.id, email: user.email, name: user.name };
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function createPasswordAuthRouter(prisma: PrismaClient) {
  const router = Router();

  router.post("/register", async (request, response) => {
    const emailInput: unknown = request.body?.email;
    const password: unknown = request.body?.password;
    const nameInput: unknown = request.body?.name;

    if (!validEmail(emailInput) || !validatePassword(password)) {
      response.status(400).json({ error: "Enter a valid email and a password of 8 to 72 characters." });
      return;
    }

    const email = emailInput.trim().toLowerCase();
    try {
      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name: typeof nameInput === "string" && nameInput.trim() ? nameInput.trim().slice(0, 120) : null,
        },
      });

      (request as AuthRequest).login(user, (error) => {
        if (error) {
          console.error("New account session could not be established:", error);
          response.status(500).json({ error: "Account created, but sign-in could not be completed. Please sign in." });
          return;
        }
        response.status(201).json({ user: safeUser(user) });
      });
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        response.status(409).json({ error: "An account with this email already exists. Try signing in instead." });
        return;
      }
      console.error("Account registration failed:", error);
      response.status(500).json({ error: "Account could not be created." });
    }
  });

  router.post("/login", async (request, response) => {
    const emailInput: unknown = request.body?.email;
    const password: unknown = request.body?.password;

    if (!validEmail(emailInput) || typeof password !== "string" || password.length > 72) {
      response.status(400).json({ error: "Enter a valid email and password." });
      return;
    }

    try {
      const user = await prisma.user.findUnique({
        where: { email: emailInput.trim().toLowerCase() },
      });
      const isValid = await verifyPassword(password, user?.passwordHash ?? null);

      if (!user || !isValid) {
        response.status(401).json({ error: "Invalid email or password." });
        return;
      }

      (request as AuthRequest).login(user, (error) => {
        if (error) {
          console.error("Password login session could not be established:", error);
          response.status(500).json({ error: "Sign-in could not be completed. Please try again." });
          return;
        }
        response.status(200).json({ user: safeUser(user) });
      });
    } catch (error: unknown) {
      console.error("Password login failed:", error);
      response.status(500).json({ error: "Sign-in could not be completed. Please try again." });
    }
  });

  router.post("/password", requireAuthenticated, async (request, response) => {
    const userId = request.user?.id;
    const password: unknown = request.body?.password;
    if (!userId || !validatePassword(password)) {
      response.status(userId ? 400 : 401).json({
        error: userId ? "Password must be between 8 and 72 characters." : "Authentication required",
      });
      return;
    }

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(password) },
      });
      response.status(204).end();
    } catch (error: unknown) {
      console.error("Password could not be set:", error);
      response.status(500).json({ error: "Password could not be set. Please try again." });
    }
  });

  return router;
}
