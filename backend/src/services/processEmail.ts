import { EmailStatus, SendLogStatus, type PrismaClient } from "@prisma/client";
import { sendEmail } from "./mailer.js";
import type { RateLimitDecision } from "./campaignRateLimiter.js";
import type { EmailIndexDocument } from "./emailSearch.js";
import type { RateLimitNotification } from "./slackNotifications.js";

type EmailProcessorDependencies = {
  prisma: PrismaClient;
  deliver: typeof sendEmail;
  reserveRateSlot: (
    campaignId: string,
    hourlyLimit: number,
    minimumDelayMs: number,
    emailId: string,
    attempt: number,
  ) => Promise<RateLimitDecision>;
  reschedule: (emailId: string, delayMs: number) => Promise<void>;
  notifyRateLimit: (event: RateLimitNotification) => Promise<boolean>;
  indexEmail: (document: EmailIndexDocument) => Promise<boolean>;
  now?: () => Date;
};

export async function processEmail(
  emailId: string,
  attempt: number,
  { prisma, deliver, reserveRateSlot, reschedule, notifyRateLimit, indexEmail, now = () => new Date() }: EmailProcessorDependencies,
): Promise<void> {
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { campaign: true },
  });

  if (!email) {
    throw new Error(`Scheduled email ${emailId} does not exist`);
  }

  if (email.status === EmailStatus.SENT) {
    console.info(`Skipping already-sent email ${emailId}`);
    return;
  }

  const priorSuccess = await prisma.sendLog.findFirst({
    where: { emailId, status: SendLogStatus.SUCCEEDED },
    select: { id: true },
  });

  if (priorSuccess) {
    console.warn(`Skipping email ${emailId}: successful send log already exists`);
    return;
  }

  const claim = await prisma.email.updateMany({
    where: { id: emailId, status: { in: [EmailStatus.SCHEDULED, EmailStatus.FAILED] } },
    data: { status: EmailStatus.PROCESSING, error: null },
  });

  if (claim.count !== 1) {
    console.info(`Skipping email ${emailId}: it is already being processed`);
    return;
  }

  let rateDecision: RateLimitDecision;
  try {
    rateDecision = await reserveRateSlot(
      email.campaignId,
      email.campaign.hourlyLimit,
      email.campaign.minimumDelayMs,
      emailId,
      attempt,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.email.update({
      where: { id: emailId },
      data: { status: EmailStatus.FAILED, error: `Rate-limit reservation failed: ${message}` },
    });
    throw error;
  }

  if (!rateDecision.allowed) {
    await prisma.email.update({
      where: { id: emailId },
      data: { status: EmailStatus.SCHEDULED, error: null },
    });

    try {
      await reschedule(emailId, rateDecision.retryAfterMs);
      console.info(
        `Rate limit reached for campaign ${email.campaignId}; rescheduled email ${emailId} in ${rateDecision.retryAfterMs}ms`,
      );
      if (rateDecision.hourlyLimitReached && rateDecision.hourlyWindowEndsAtMs !== null) {
        try {
          await notifyRateLimit({
            campaignId: email.campaignId,
            campaignName: email.campaign.subject,
            userId: email.campaign.userId,
            hourlyLimit: email.campaign.hourlyLimit,
            nextEligibleAtMs: rateDecision.nextEligibleAtMs,
            hourlyWindowEndsAtMs: rateDecision.hourlyWindowEndsAtMs,
          });
        } catch (error: unknown) {
          console.error("Slack rate-limit notification failed; continuing email processing:", error);
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.email.update({
        where: { id: emailId },
        data: { status: EmailStatus.FAILED, error: `Rate-limit rescheduling failed: ${message}` },
      });
      throw error;
    }

    return;
  }

  const idempotencyKey = `email:${emailId}:attempt:${attempt}`;
  let log;
  try {
    log = await prisma.sendLog.create({
      data: {
        emailId,
        idempotencyKey,
        attempt,
        status: SendLogStatus.STARTED,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.email.update({
      where: { id: emailId },
      data: { status: EmailStatus.FAILED, error: `Send log creation failed: ${message}` },
    });
    throw error;
  }

  try {
    const previewUrl = await deliver({
      to: email.recipientEmail,
      subject: email.campaign.subject,
      text: email.campaign.body,
    });
    const sentAt = now();

    await prisma.$transaction([
      prisma.email.update({
        where: { id: emailId },
        data: { status: EmailStatus.SENT, sentAt, error: null },
      }),
      prisma.sendLog.update({
        where: { id: log.id },
        data: { status: SendLogStatus.SUCCEEDED, error: null },
      }),
    ]);

    await indexEmail({
      emailId: email.id,
      campaignId: email.campaignId,
      recipient: email.recipientEmail,
      subject: email.campaign.subject,
      body: email.campaign.body,
      status: EmailStatus.SENT,
      scheduledAt: email.scheduledAt,
      sentAt,
    });

    console.info(`Sent email ${emailId}${previewUrl ? `; Ethereal preview: ${previewUrl}` : ""}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.$transaction([
      prisma.email.update({
        where: { id: emailId },
        data: { status: EmailStatus.FAILED, error: message },
      }),
      prisma.sendLog.update({
        where: { id: log.id },
        data: { status: SendLogStatus.FAILED, error: message },
      }),
    ]);

    console.error(`Failed to send email ${emailId}:`, message);
    throw error;
  }
}