import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAuthenticated } from "../auth/requireAuthenticated.js";

type SlackOAuthResponse = {
  ok?: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  team?: { id?: string; name?: string };
  incoming_webhook?: { channel_id?: string; channel_name?: string };
  authed_user?: { id?: string };
};

type SlackOAuthDependencies = {
  prisma: PrismaClient;
  fetcher?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  frontendUrl?: string;
};

export function createSlackOAuthRouter(dependencies: SlackOAuthDependencies) {
  const router = Router();
  const fetcher = dependencies.fetcher ?? fetch;
  const clientId = dependencies.clientId ?? process.env.SLACK_CLIENT_ID;
  const clientSecret = dependencies.clientSecret ?? process.env.SLACK_CLIENT_SECRET;
  const redirectUri = dependencies.redirectUri ?? process.env.SLACK_REDIRECT_URI;
  const frontendUrl = dependencies.frontendUrl ?? process.env.FRONTEND_URL ?? "http://localhost:5173";
  const enabled = Boolean(clientId && clientSecret && redirectUri);

  router.get("/slack", requireAuthenticated, (request, response) => {
    if (!enabled) {
      response.status(503).json({ error: "Slack OAuth is not configured" });
      return;
    }

    const state = randomBytes(32).toString("base64url");
    request.session.slackOAuthState = state;

    const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
    authorizeUrl.searchParams.set("client_id", clientId!);
    authorizeUrl.searchParams.set("scope", "chat:write,incoming-webhook");
    authorizeUrl.searchParams.set("redirect_uri", redirectUri!);
    authorizeUrl.searchParams.set("state", state);
    response.redirect(authorizeUrl.toString());
  });

  router.get("/slack/callback", requireAuthenticated, async (request, response) => {
    if (!enabled) {
      response.status(503).json({ error: "Slack OAuth is not configured" });
      return;
    }

    const state = typeof request.query.state === "string" ? request.query.state : "";
    const expectedState = request.session.slackOAuthState;
    delete request.session.slackOAuthState;

    if (
      !expectedState ||
      !state ||
      Buffer.byteLength(state) !== Buffer.byteLength(expectedState) ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))
    ) {
      response.status(400).json({ error: "Invalid Slack OAuth state" });
      return;
    }

    const code = typeof request.query.code === "string" ? request.query.code : "";
    if (!code || request.query.error) {
      response.redirect(`${frontendUrl}/?slack=failed`);
      return;
    }

    try {
      const tokenResponse = await fetcher("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId!,
          client_secret: clientSecret!,
          redirect_uri: redirectUri!,
        }),
      });
      const token = (await tokenResponse.json()) as SlackOAuthResponse;
      const teamId = token.team?.id;
      const teamName = token.team?.name;
      const channelId = token.incoming_webhook?.channel_id;
      const channelName = token.incoming_webhook?.channel_name;
      const botUserId = token.bot_user_id;

      if (
        !tokenResponse.ok || !token.ok || !token.access_token || !teamId || !teamName ||
        !channelId || !channelName || !botUserId
      ) {
        throw new Error(`Slack OAuth token exchange failed: ${token.error ?? tokenResponse.statusText}`);
      }

      await dependencies.prisma.slackInstallation.upsert({
        where: { userId_teamId: { userId: request.user!.id, teamId } },
        create: {
          userId: request.user!.id,
          teamId,
          teamName,
          botUserId,
          botAccessToken: token.access_token,
          channelId,
          channelName,
          installerSlackUserId: token.authed_user?.id ?? null,
        },
        update: {
          teamName,
          botUserId,
          botAccessToken: token.access_token,
          channelId,
          channelName,
          installerSlackUserId: token.authed_user?.id ?? null,
        },
      });

      response.redirect(`${frontendUrl}/?slack=connected`);
    } catch (error: unknown) {
      console.error("Slack OAuth callback failed:", error);
      response.redirect(`${frontendUrl}/?slack=failed`);
    }
  });

  return router;
}
