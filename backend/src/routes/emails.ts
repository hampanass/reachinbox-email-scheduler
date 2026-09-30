import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { requireAuthenticated } from "../auth/requireAuthenticated.js";

export function createEmailsRouter(prisma: PrismaClient) {
  const router = Router();
  router.use(requireAuthenticated);

  router.get("/:id", async (request, response) => {
    const userId = request.user?.id;
    if (!userId) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const email = await prisma.email.findFirst({
        where: {
          id: request.params.id,
          campaign: { userId },
        },
        select: {
          id: true,
          recipientEmail: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          campaign: {
            select: {
              id: true,
              subject: true,
              body: true,
              startAt: true,
              createdAt: true,
            },
          },
        },
      });

      if (!email) {
        response.status(404).json({ error: "Email not found" });
        return;
      }

      response.status(200).json({
        id: email.id,
        recipient: email.recipientEmail,
        subject: email.campaign.subject,
        body: email.campaign.body,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
        campaign: {
          id: email.campaign.id,
          name: email.campaign.subject,
          startAt: email.campaign.startAt,
          createdAt: email.campaign.createdAt,
        },
      });
    } catch (error: unknown) {
      console.error("Email detail could not be loaded:", error);
      response.status(500).json({ error: "Email details could not be loaded" });
    }
  });

  return router;
}
