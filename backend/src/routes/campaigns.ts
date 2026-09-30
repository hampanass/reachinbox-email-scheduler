import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { DelayedJobQueue } from "../services/scheduling.js";
import { createCampaign } from "../services/campaigns.js";
import { indexEmailRecord } from "../services/emailSearch.js";
import { requireAuthenticated } from "../auth/requireAuthenticated.js";

type CampaignRouterDependencies = {
  prisma: PrismaClient;
  queue: DelayedJobQueue;
};

function parseCampaignInput(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const { subject, body, recipients, startTime, delayBetweenEmails, hourlyLimit } = input;
  const startAt = typeof startTime === "string" ? new Date(startTime) : new Date(NaN);

  if (
    typeof subject !== "string" || !subject.trim() || subject.length > 998 ||
    typeof body !== "string" || !body.trim() ||
    !Array.isArray(recipients) || recipients.length === 0 || recipients.length > 1000 ||
    !recipients.every((item) => typeof item === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.trim())) ||
    !Number.isFinite(startAt.getTime()) || startAt.getTime() < Date.now() ||
    typeof delayBetweenEmails !== "number" || !Number.isInteger(delayBetweenEmails) || delayBetweenEmails < 0 ||
    typeof hourlyLimit !== "number" || !Number.isInteger(hourlyLimit) || hourlyLimit < 1
  ) {
    return null;
  }

  const normalizedRecipients = (recipients as string[]).map((recipient) => recipient.trim().toLowerCase());
  if (new Set(normalizedRecipients).size !== normalizedRecipients.length) return null;

  return {
    subject: subject.trim(),
    body,
    recipients: normalizedRecipients,
    startTime: startAt,
    delayBetweenEmails,
    hourlyLimit,
  };
}

export function createCampaignsRouter({ prisma, queue }: CampaignRouterDependencies) {
  const router = Router();
  router.use(requireAuthenticated);

  router.post("/", async (request, response) => {
    const userId = request.user?.id;
    if (!userId) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    const input = parseCampaignInput(request.body);
    if (!input) {
      response.status(400).json({ error: "Invalid campaign. Check all fields and recipient email addresses." });
      return;
    }

    try {
      const campaign = await createCampaign(input, { prisma, queue, userId });
      await Promise.all(
        campaign.emails.map((email) =>
          indexEmailRecord({
            emailId: email.id,
            campaignId: campaign.id,
            recipient: email.recipientEmail,
            subject: campaign.subject,
            body: campaign.body,
            status: email.status,
            scheduledAt: email.scheduledAt,
            sentAt: email.sentAt,
          }),
        ),
      );
      response.status(201).json(campaign);
    } catch (error: unknown) {
      console.error("Campaign creation failed:", error);
      response.status(500).json({ error: "Campaign could not be created" });
    }
  });

  router.get("/", async (request, response) => {
    const userId = request.user?.id;
    if (!userId) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const campaigns = await prisma.campaign.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: {
          emails: {
            orderBy: { scheduledAt: "asc" },
            select: {
              id: true,
              recipientEmail: true,
              status: true,
              scheduledAt: true,
              sentAt: true,
              error: true,
            },
          },
        },
      });
      response.status(200).json(campaigns);
    } catch (error: unknown) {
      console.error("Campaign listing failed:", error);
      response.status(500).json({ error: "Campaigns could not be loaded" });
    }
  });

  return router;
}