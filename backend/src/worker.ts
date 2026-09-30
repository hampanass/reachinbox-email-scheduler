import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { prisma } from "./db/prisma.js";
import { EmailStatus } from "@prisma/client";
import { emailQueue, type EmailJobData } from "./queue/emailQueue.js";
import { redisConnection } from "./queue/redis.js";
import { sendEmail } from "./services/mailer.js";
import { processEmail } from "./services/processEmail.js";
import { reserveCampaignRateSlot } from "./services/campaignRateLimiter.js";
import { indexEmailRecord } from "./services/emailSearch.js";
import { notifySlackRateLimitReached } from "./services/slackNotifications.js";

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? "5");
if (!Number.isInteger(concurrency) || concurrency < 1) {
  throw new Error("WORKER_CONCURRENCY must be a positive integer");
}

const worker = new Worker<EmailJobData>(
  "scheduled-emails",
  async (job) =>
    processEmail(job.data.emailId, job.attemptsMade + 1, {
      prisma,
      deliver: sendEmail,
      reserveRateSlot: (campaignId, hourlyLimit, minimumDelayMs, emailId, attempt) =>
        reserveCampaignRateSlot(
          redisConnection,
          campaignId,
          hourlyLimit,
          minimumDelayMs,
          emailId,
          attempt,
        ),
      reschedule: async (emailId, delayMs) => {
        await emailQueue.add(
          "send-email",
          { emailId },
          {
            jobId: `rate-${emailId}-${randomUUID()}`,
            delay: Math.max(1, delayMs),
          },
        );
      },
      notifyRateLimit: (event) => notifySlackRateLimitReached(event, { prisma }),
      indexEmail: indexEmailRecord,
    }),
  { connection: redisConnection, concurrency },
);

worker.on("completed", (job) => console.info(`Email job ${job.id} completed`));
worker.on("failed", async (job, error) => {
  console.error(`Email job ${job?.id ?? "unknown"} failed:`, error);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await prisma.email.updateMany({
      where: { id: job.data.emailId, status: EmailStatus.PROCESSING },
      data: { status: EmailStatus.FAILED, error: error.message },
    });
  }
});

console.info(`Email worker started with concurrency ${concurrency}`);

async function shutdown(signal: string) {
  console.info(`${signal} received; closing email worker`);
  await worker.close();
  await emailQueue.close();
  await prisma.$disconnect();
  await redisConnection.quit();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));