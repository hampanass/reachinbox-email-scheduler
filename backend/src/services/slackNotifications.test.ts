import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { EmailStatus, SlackRateLimitNotificationStatus } from "@prisma/client";
import { test } from "node:test";
import { processEmail } from "./processEmail.js";
import {
  buildRateLimitSlackMessage,
  notifySlackRateLimitReached,
  type RateLimitNotification,
} from "./slackNotifications.js";

const event: RateLimitNotification = {
  campaignId: "campaign-123",
  campaignName: "Quarterly update",
  userId: "user-42",
  hourlyLimit: 25,
  nextEligibleAtMs: Date.parse("2030-01-01T12:00:00.000Z"),
  hourlyWindowEndsAtMs: Date.parse("2030-01-01T12:00:00.000Z"),
};

function fakeInstallations() {
  return [{
    teamName: "Example Workspace",
    botAccessToken: "xoxb-test-token",
    channelId: "C123456",
    channelName: "campaign-alerts",
  }];
}

test("Slack payload names the campaign, limit, and approximate next send time", async () => {
  const message = buildRateLimitSlackMessage(event);
  assert.match(message, /Quarterly update/);
  assert.match(message, /campaign-123/);
  assert.match(message, /25 emails per hour/);
  assert.match(message, /2030-01-01T12:00:00\.000Z/);

  let submitted: { channel: string; text: string } | undefined;
  const fakePrisma = {
    slackInstallation: { findMany: async () => fakeInstallations() },
    slackRateLimitNotification: {
      create: async () => ({ id: "notification-1" }),
      update: async () => ({}),
    },
  } as unknown as PrismaClient;

  const delivered = await notifySlackRateLimitReached(event, {
    prisma: fakePrisma,
    fetcher: async (_url, init) => {
      submitted = JSON.parse(String(init?.body)) as { channel: string; text: string };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(delivered, true);
  assert.equal(submitted?.channel, "C123456");
  assert.match(submitted?.text ?? "", /campaign-123/);
});

test("Slack notification event is claimed once across duplicate workers", async () => {
  const eventKeys = new Set<string>();
  let apiCalls = 0;
  const fakePrisma = {
    slackInstallation: { findMany: async () => fakeInstallations() },
    slackRateLimitNotification: {
      create: async ({ data }: { data: { eventKey: string } }) => {
        if (eventKeys.has(data.eventKey)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        eventKeys.add(data.eventKey);
        return { id: data.eventKey };
      },
      update: async () => ({}),
    },
  } as unknown as PrismaClient;
  const notifierOptions = {
    prisma: fakePrisma,
    fetcher: async () => {
      apiCalls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    logger: { info() {}, warn() {}, error() {} },
  };

  const results = await Promise.all([
    notifySlackRateLimitReached(event, notifierOptions),
    notifySlackRateLimitReached(event, notifierOptions),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(apiCalls, 1);
  assert.equal(eventKeys.size, 1);
});

test("Slack API failures do not fail or interrupt the scheduled email worker job", async () => {
  let emailStatus: EmailStatus = EmailStatus.SCHEDULED;
  let notificationStatus: SlackRateLimitNotificationStatus | undefined;
  let rescheduled = false;
  let deliveryCalls = 0;
  const fakePrisma = {
    email: {
      findUnique: async () => ({
        id: "email-rate-limited",
        status: emailStatus,
        campaignId: event.campaignId,
        recipientEmail: "recipient@example.test",
        scheduledAt: new Date(event.nextEligibleAtMs - 60_000),
        campaign: {
          id: event.campaignId,
          userId: event.userId,
          subject: event.campaignName,
          body: "Message body",
          hourlyLimit: event.hourlyLimit,
          minimumDelayMs: 0,
        },
      }),
      updateMany: async () => {
        if (emailStatus !== EmailStatus.SCHEDULED) return { count: 0 };
        emailStatus = EmailStatus.PROCESSING;
        return { count: 1 };
      },
      update: async ({ data }: { data: { status: EmailStatus } }) => {
        emailStatus = data.status;
        return {};
      },
    },
    sendLog: { findFirst: async () => null },
    slackInstallation: { findMany: async () => fakeInstallations() },
    slackRateLimitNotification: {
      create: async () => ({ id: "notification-1" }),
      update: async ({ data }: { data: { status: SlackRateLimitNotificationStatus } }) => {
        notificationStatus = data.status;
        return {};
      },
    },
  } as unknown as PrismaClient;

  await processEmail("email-rate-limited", 1, {
    prisma: fakePrisma,
    deliver: async () => {
      deliveryCalls += 1;
      return undefined;
    },
    reserveRateSlot: async () => ({
      allowed: false,
      retryAfterMs: 60_000,
      hourlyLimitReached: true,
      nextEligibleAtMs: event.nextEligibleAtMs,
      hourlyWindowEndsAtMs: event.hourlyWindowEndsAtMs,
    }),
    reschedule: async () => { rescheduled = true; },
    notifyRateLimit: (rateLimitEvent) => notifySlackRateLimitReached(rateLimitEvent, {
      prisma: fakePrisma,
      fetcher: async () => { throw new Error("Slack API unavailable"); },
      logger: { info() {}, warn() {}, error() {} },
    }),
    indexEmail: async () => true,
  });

  assert.equal(emailStatus, EmailStatus.SCHEDULED);
  assert.equal(rescheduled, true);
  assert.equal(deliveryCalls, 0);
  assert.equal(notificationStatus, SlackRateLimitNotificationStatus.FAILED);
});
