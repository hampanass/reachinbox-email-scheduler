import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { EmailStatus, SendLogStatus } from "@prisma/client";
import { after, test } from "node:test";
import { Redis } from "ioredis";
import type { DelayedJobQueue } from "./scheduling.js";
import { createCampaign } from "./campaigns.js";
import { processEmail } from "./processEmail.js";
import { enqueueScheduledEmails } from "./scheduling.js";
import { campaignRateLimitKey, reserveCampaignRateSlot } from "./campaignRateLimiter.js";

const testRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const rateLimitKeys: string[] = [];

after(async () => {
  if (rateLimitKeys.length > 0) await testRedis.del(...rateLimitKeys);
  await testRedis.quit();
});

function newCampaignId() {
  const id = `rate-test-${randomUUID()}`;
  rateLimitKeys.push(campaignRateLimitKey(id));
  return id;
}

test("campaign creation persists recipients and creates one delayed job per email", async () => {
  const startTime = new Date("2030-01-01T00:00:00.000Z");
  const queueJobs: Array<{ name: string; data: { emailId: string }; options: { jobId: string; delay: number } }> = [];
  const emailRows = [
    { id: "email-1", scheduledAt: startTime },
    { id: "email-2", scheduledAt: new Date(startTime.getTime() + 1_800_000) },
  ];
  let storedCampaignData: unknown;
  const fakePrisma = {
    campaign: {
      create: async (args: { data: unknown }) => {
        storedCampaignData = args.data;
        return { id: "campaign-1", emails: emailRows };
      },
    },
  } as unknown as PrismaClient;
  const fakeQueue: DelayedJobQueue = {
    add: async (name, data, options) => {
      queueJobs.push({ name, data, options });
    },
  };

  const result = await createCampaign(
    {
      subject: "Hello",
      body: "Test message",
      recipients: ["one@example.test", "two@example.test"],
      startTime,
      delayBetweenEmails: 1_000,
      hourlyLimit: 2,
    },
    { prisma: fakePrisma, queue: fakeQueue, userId: "test-user", now: startTime.getTime() },
  );

  assert.equal(result.id, "campaign-1");
  assert.ok(storedCampaignData);
  assert.equal(queueJobs.length, 2);
  assert.deepEqual(queueJobs.map((job) => job.options.jobId), ["email-1", "email-2"]);
  assert.deepEqual(queueJobs.map((job) => job.options.delay), [0, 1_800_000]);
});

test("enqueueScheduledEmails preserves future due times as BullMQ delays", async () => {
  const added: Array<{ data: { emailId: string }; options: { jobId: string; delay: number } }> = [];
  const queue: DelayedJobQueue = {
    add: async (_name, data, options) => {
      added.push({ data, options });
    },
  };

  await enqueueScheduledEmails(
    queue,
    [{ id: "future-email", scheduledAt: new Date(50_000) }],
    20_000,
  );

  assert.deepEqual(added, [{ data: { emailId: "future-email" }, options: { jobId: "future-email", delay: 30_000 } }]);
});

test("processing the same email twice sends it once and records one success", async () => {
  let emailStatus: EmailStatus = EmailStatus.SCHEDULED;
  let deliverCalls = 0;
  const logs: Array<{ id: string; status: SendLogStatus; idempotencyKey: string }> = [];

  const fakePrisma = {
    email: {
      findUnique: async () => ({
        id: "email-idempotent",
        status: emailStatus,
        campaignId: "campaign-idempotent",
        recipientEmail: "recipient@example.test",
        campaign: {
          subject: "Subject",
          body: "Body",
          hourlyLimit: 10,
          minimumDelayMs: 0,
        },
      }),
      updateMany: async ({ where }: { where: { status: { in: EmailStatus[] } } }) => {
        if (!where.status.in.includes(emailStatus)) return { count: 0 };
        emailStatus = EmailStatus.PROCESSING;
        return { count: 1 };
      },
      update: async ({ data }: { data: { status: EmailStatus } }) => {
        emailStatus = data.status;
        return {};
      },
    },
    sendLog: {
      findFirst: async () =>
        logs.some((log) => log.status === SendLogStatus.SUCCEEDED) ? { id: "success" } : null,
      create: async ({ data }: { data: { status: SendLogStatus; idempotencyKey: string } }) => {
        const log = { id: `log-${logs.length + 1}`, ...data };
        logs.push(log);
        return log;
      },
      update: async ({ where, data }: { where: { id: string }; data: { status: SendLogStatus } }) => {
        const log = logs.find((item) => item.id === where.id)!;
        log.status = data.status;
        return log;
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaClient;

  const deliver = async () => {
    deliverCalls += 1;
    return "https://ethereal.email/message/test";
  };

  const dependencies = {
    prisma: fakePrisma,
    deliver,
    reserveRateSlot: async () => ({
      allowed: true,
      retryAfterMs: 0,
      hourlyLimitReached: false,
      nextEligibleAtMs: Date.now(),
      hourlyWindowEndsAtMs: null,
    }),
    reschedule: async () => {},
    notifyRateLimit: async () => false,
    indexEmail: async () => true,
  };
  await processEmail("email-idempotent", 1, dependencies);
  await processEmail("email-idempotent", 2, dependencies);

  assert.equal(deliverCalls, 1);
  assert.equal(emailStatus, EmailStatus.SENT);
  assert.equal(logs.filter((log) => log.status === SendLogStatus.SUCCEEDED).length, 1);
});

test("campaign hourly limit rejects sends after the configured allowance", async () => {
  const campaignId = newCampaignId();
  const first = await reserveCampaignRateSlot(testRedis, campaignId, 2, 0, "email-a", 1);
  const second = await reserveCampaignRateSlot(testRedis, campaignId, 2, 0, "email-b", 1);
  const third = await reserveCampaignRateSlot(testRedis, campaignId, 2, 0, "email-c", 1);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterMs > 0 && third.retryAfterMs <= 3_600_001);
});

test("Redis gate preserves the configured minimum delay between campaign emails", async () => {
  const campaignId = newCampaignId();
  const first = await reserveCampaignRateSlot(testRedis, campaignId, 100, 30_000, "delay-a", 1);
  const second = await reserveCampaignRateSlot(testRedis, campaignId, 100, 30_000, "delay-b", 1);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.ok(second.retryAfterMs > 0 && second.retryAfterMs <= 30_000);
});

test("simultaneous workers cannot exceed the same campaign hourly limit", async () => {
  const campaignId = newCampaignId();
  const workerConnections = Array.from(
    { length: 12 },
    () => new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null }),
  );
  let decisions;
  try {
    decisions = await Promise.all(
      workerConnections.map((connection, index) =>
        reserveCampaignRateSlot(connection, campaignId, 3, 0, `concurrent-${index}`, 1),
      ),
    );
  } finally {
    await Promise.all(workerConnections.map((connection) => connection.quit()));
  }

  assert.equal(decisions.filter((decision) => decision.allowed).length, 3);
  assert.ok(decisions.filter((decision) => !decision.allowed).every((decision) => decision.retryAfterMs > 0));
});

test("emails become eligible again after the prior hourly window expires", async () => {
  const campaignId = newCampaignId();
  const key = campaignRateLimitKey(campaignId);
  const first = await reserveCampaignRateSlot(testRedis, campaignId, 1, 0, "hour-one", 1);
  assert.equal(first.allowed, true);

  const [member] = await testRedis.zrange(key, "0", "0");
  assert.ok(member);
  await testRedis.zadd(key, Date.now() - 3_600_001, member);

  const nextWindow = await reserveCampaignRateSlot(testRedis, campaignId, 1, 0, "hour-two", 1);
  assert.equal(nextWindow.allowed, true);
});

test("rate-limited email stays scheduled and is rescheduled without sending", async () => {
  let emailStatus: EmailStatus = EmailStatus.SCHEDULED;
  let deliverCalls = 0;
  const rescheduled: Array<{ emailId: string; delayMs: number }> = [];
  const fakePrisma = {
    email: {
      findUnique: async () => ({
        id: "rate-limited-email",
        status: emailStatus,
        campaignId: "limited-campaign",
        recipientEmail: "recipient@example.test",
        campaign: { subject: "Subject", body: "Body", hourlyLimit: 1, minimumDelayMs: 0 },
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
    sendLog: {
      findFirst: async () => null,
      create: async () => {
        throw new Error("A denied email must not create a send log");
      },
    },
  } as unknown as PrismaClient;

  await processEmail("rate-limited-email", 1, {
    prisma: fakePrisma,
    deliver: async () => {
      deliverCalls += 1;
      return undefined;
    },
    reserveRateSlot: async () => ({
      allowed: false,
      retryAfterMs: 42_000,
      hourlyLimitReached: false,
      nextEligibleAtMs: Date.now() + 42_000,
      hourlyWindowEndsAtMs: null,
    }),
    reschedule: async (emailId, delayMs) => {
      rescheduled.push({ emailId, delayMs });
    },
    notifyRateLimit: async () => false,
    indexEmail: async () => true,
  });

  assert.equal(emailStatus, EmailStatus.SCHEDULED);
  assert.equal(deliverCalls, 0);
  assert.deepEqual(rescheduled, [{ emailId: "rate-limited-email", delayMs: 42_000 }]);
});