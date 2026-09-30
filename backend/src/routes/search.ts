import { Router } from "express";

export type EmailSearchResult = {
  id: string;
  emailId: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string | Date;
  sentAt: string | Date | null;
};

type SearchEmails = (query: string) => Promise<EmailSearchResult[]>;

export function createSearchRouter(search: SearchEmails) {
  const router = Router();

  router.get("/emails", async (request, response) => {
    const query = request.query.q;
    if (typeof query !== "string" || !query.trim() || query.length > 200) {
      response.status(400).json({ error: "Provide a non-empty q parameter of at most 200 characters" });
      return;
    }

    try {
      const results = await search(query.trim());
      response.status(200).json({ results });
    } catch (error: unknown) {
      console.error("Email search is unavailable:", error);
      response.status(503).json({ error: "Email search is temporarily unavailable" });
    }
  });

  return router;
}
