import "dotenv/config";
import { SlackRateLimitNotificationStatus, type PrismaClient } from "@prisma/client";

type SlackInstallation = {
  teamName: string;
  botAccessToken: string;
  channelId: string;
  channelName: string;
};

type SlackApiResponse = { ok?: boolean; error?: string };

export type RateLimitNotification = {
  campaignId: string;
  campaignName: string;
  userId: string;
  hourlyLimit: number;
  nextEligibleAtMs: number;
  hourlyWindowEndsAtMs: number;
};

type SlackNotificationDependencies = {
  prisma: PrismaClient;
  fetcher?: typeof fetch;
  logger?: Pick<Console, "info" | "warn" | "error">;
};

export function buildRateLimitSlackMessage(event: RateLimitNotification): string {
  const nextEligible = new Date(event.nextEligibleAtMs);
  const displayTime = Number.isNaN(nextEligible.getTime())
    ? "soon"
    : `${nextEligible.toISOString()} (UTC)`;

  return [
    ":warning: Campaign hourly email limit reached",
    `Campaign: ${event.campaignName} (${event.campaignId})`,
    `Limit: ${event.hourlyLimit} emails per hour`,
    `Approximate next eligible send: ${displayTime}`,
  ].join("\n");
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "P2002",
  );
}

export async function notifySlackRateLimitReached(
  event: RateLimitNotification,
  { prisma, fetcher = fetch, logger = console }: SlackNotificationDependencies,
): Promise<boolean> {
  try {
    const installations = await prisma.slackInstallation.findMany({
      where: { userId: event.userId },
      select: { teamName: true, botAccessToken: true, channelId: true, channelName: true },
    }) as SlackInstallation[];

    if (installations.length === 0) {
      logger.info(`No Slack installation for user ${event.userId}; skipping rate-limit notification`);
      return false;
    }

    const eventKey = `campaign-hourly-limit:${event.campaignId}:${event.hourlyWindowEndsAtMs}`;
    try {
      await prisma.slackRateLimitNotification.create({
        data: {
          eventKey,
          campaignId: event.campaignId,
          userId: event.userId,
          nextEligibleAt: new Date(event.nextEligibleAtMs),
          status: SlackRateLimitNotificationStatus.PENDING,
        },
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        logger.info(`Slack notification already claimed for ${eventKey}`);
        return false;
      }
      throw error;
    }

    const text = buildRateLimitSlackMessage(event);
    const failures: string[] = [];
    let delivered = 0;

    for (const installation of installations) {
      try {
        const response = await fetcher("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            authorization: `Bearer ${installation.botAccessToken}`,
            "content-type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            channel: installation.channelId,
            text,
            unfurl_links: false,
            unfurl_media: false,
          }),
          signal: AbortSignal.timeout(5_000),
        });
        const result = (await response.json()) as SlackApiResponse;
        if (!response.ok || !result.ok) {
          failures.push(`${installation.teamName}/${installation.channelName}: ${result.error ?? response.statusText}`);
          continue;
        }
        delivered += 1;
      } catch (error: unknown) {
        failures.push(`${installation.teamName}/${installation.channelName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const status = delivered > 0
      ? SlackRateLimitNotificationStatus.SENT
      : SlackRateLimitNotificationStatus.FAILED;
    const error = failures.length > 0 ? failures.join("; ").slice(0, 4_000) : null;

    await prisma.slackRateLimitNotification.update({
      where: { eventKey },
      data: { status, error },
    });

    if (failures.length > 0) logger.warn(`Some Slack rate-limit notifications failed for ${eventKey}: ${error}`);
    return delivered > 0;
  } catch (error: unknown) {
    logger.error("Slack rate-limit notification failed; email processing will continue:", error);
    return false;
  }
}
