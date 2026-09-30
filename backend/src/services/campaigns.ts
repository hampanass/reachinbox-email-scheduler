import type { PrismaClient } from "@prisma/client";
import type { DelayedJobQueue } from "./scheduling.js";
import { buildSchedule, enqueueScheduledEmails } from "./scheduling.js";

export type CreateCampaignInput = {
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayBetweenEmails: number;
  hourlyLimit: number;
};

export async function createCampaign(
  input: CreateCampaignInput,
  dependencies: { prisma: PrismaClient; queue: DelayedJobQueue; userId: string; now?: number },
) {
  const { prisma, queue, userId } = dependencies;

  const schedule = buildSchedule(
    input.startTime,
    input.delayBetweenEmails,
    input.hourlyLimit,
    input.recipients.length,
  );

  const campaign = await prisma.campaign.create({
    data: {
      userId,
      subject: input.subject,
      body: input.body,
      startAt: input.startTime,
      minimumDelayMs: input.delayBetweenEmails,
      hourlyLimit: input.hourlyLimit,
      emails: {
        create: input.recipients.map((recipientEmail, index) => ({
          recipientEmail,
          scheduledAt: schedule[index]!,
        })),
      },
    },
    include: { emails: true },
  });

  await enqueueScheduledEmails(queue, campaign.emails, dependencies.now ?? Date.now());
  return campaign;
}