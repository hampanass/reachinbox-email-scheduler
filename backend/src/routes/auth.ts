import { Router } from "express";
import type { PassportStatic } from "passport";

export function createAuthRouter(
  passport: Pick<PassportStatic, "authenticate">,
  googleOAuthEnabled: boolean,
) {
  const router = Router();
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

  router.get("/google", (request, response, next) => {
    if (!googleOAuthEnabled) {
      response.status(503).json({ error: "Google OAuth is not configured" });
      return;
    }

    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: true,
    })(request, response, next);
  });

  router.get(
    "/google/callback",
    (request, response, next) => {
      if (!googleOAuthEnabled) {
        response.status(503).json({ error: "Google OAuth is not configured" });
        return;
      }

      passport.authenticate("google", {
        failureRedirect: `${frontendUrl}/?auth=failed`,
        session: true,
      })(request, response, next);
    },
    (_request, response) => response.redirect(`${frontendUrl}/?auth=success`),
  );

  router.get("/me", (request, response) => {
    if (!request.isAuthenticated?.() || !request.user) {
      response.status(401).json({ authenticated: false, user: null });
      return;
    }

    const user = request.user as Express.User;
    response.status(200).json({
      authenticated: true,
      user: { id: user.id, email: user.email, name: user.name },
    });
  });

  router.post("/logout", (request, response, next) => {
    request.logout((logoutError) => {
      if (logoutError) {
        next(logoutError);
        return;
      }

      request.session.destroy((sessionError) => {
        if (sessionError) {
          next(sessionError);
          return;
        }

        response.clearCookie("reachinbox.sid", { path: "/" });
        response.status(204).end();
      });
    });
  });

  return router;
}