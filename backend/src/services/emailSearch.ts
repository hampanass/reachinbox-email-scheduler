import "dotenv/config";
import { Client } from "@elastic/elasticsearch";
import type { EmailStatus } from "@prisma/client";

export const EMAIL_INDEX = "reachinbox-emails";

export type EmailIndexDocument = {
  emailId: string;
  campaignId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus | string;
  scheduledAt: string | Date;
  sentAt: string | Date | null;
};

type EmailSearchRequest = {
  index: string;
  size: number;
  query: {
    multi_match: {
      query: string;
      fields: string[];
      type: "best_fields";
      fuzziness: "AUTO";
    };
  };
  sort: Array<{ scheduledAt: { order: "desc" } }>;
};

export type EmailSearchClient = {
  indices: {
    exists: (request: { index: string }) => Promise<boolean>;
    create: (request: {
      index: string;
      mappings: { properties: Record<string, { type: "keyword" | "text" | "date" }> };
    }) => Promise<unknown>;
  };
  index: (request: {
    index: string;
    id: string;
    document: EmailIndexDocument;
    refresh: "wait_for";
  }) => Promise<unknown>;
  search: (request: EmailSearchRequest) => Promise<{
    hits: { hits: Array<{ _id?: string; _source?: EmailIndexDocument }> };
  }>;
};

const elasticsearchUsername = process.env.ELASTICSEARCH_USERNAME;
const elasticsearchPassword = process.env.ELASTICSEARCH_PASSWORD;
const elasticsearchAuth = elasticsearchUsername && elasticsearchPassword
  ? { username: elasticsearchUsername, password: elasticsearchPassword }
  : undefined;

const elasticsearchClient = new Client({
  node: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
  ...(elasticsearchAuth ? { auth: elasticsearchAuth } : {}),
  requestTimeout: 3_000,
  maxRetries: 1,
});

export function createEmailSearchService(client: EmailSearchClient) {
  let indexCreation: Promise<void> | undefined;

  async function ensureIndex(): Promise<void> {
    if (!indexCreation) {
      const creation = (async () => {
        const exists = await client.indices.exists({ index: EMAIL_INDEX });
        if (exists) return;

        try {
          await client.indices.create({
            index: EMAIL_INDEX,
            mappings: {
              properties: {
                emailId: { type: "keyword" },
                campaignId: { type: "keyword" },
                recipient: { type: "text" },
                subject: { type: "text" },
                body: { type: "text" },
                status: { type: "keyword" },
                scheduledAt: { type: "date" },
                sentAt: { type: "date" },
              },
            },
          });
        } catch (error: unknown) {
          const elasticError = error as { meta?: { statusCode?: number; body?: { error?: { type?: string } } } };
          if (
            elasticError.meta?.statusCode !== 400 ||
            elasticError.meta.body?.error?.type !== "resource_already_exists_exception"
          ) {
            throw error;
          }
        }
      })();
      indexCreation = creation;
    }

    const creation = indexCreation;
    try {
      await creation;
    } catch (error: unknown) {
      if (indexCreation === creation) indexCreation = undefined;
      throw error;
    }
  }

  async function indexEmail(document: EmailIndexDocument): Promise<boolean> {
    try {
      await ensureIndex();
      await client.index({
        index: EMAIL_INDEX,
        id: document.emailId,
        document,
        refresh: "wait_for",
      });
      return true;
    } catch (error: unknown) {
      console.warn(`Email ${document.emailId} could not be indexed; it can be reindexed later:`, error);
      return false;
    }
  }

  async function search(query: string) {
    await ensureIndex();
    const response = await client.search({
      index: EMAIL_INDEX,
      size: 50,
      query: {
        multi_match: {
          query,
          fields: ["recipient", "subject", "body"],
          type: "best_fields",
          fuzziness: "AUTO",
        },
      },
      sort: [{ scheduledAt: { order: "desc" } }],
    });

    return response.hits.hits.flatMap((hit) =>
      hit._source ? [{ id: hit._id ?? hit._source.emailId, ...hit._source }] : [],
    );
  }

  return { ensureIndex, indexEmail, search };
}

const emailSearchService = createEmailSearchService({
  indices: {
    exists: (request) => elasticsearchClient.indices.exists(request),
    create: (request) => elasticsearchClient.indices.create(request),
  },
  index: (request) => elasticsearchClient.index(request),
  search: (request) => elasticsearchClient.search<EmailIndexDocument>(request),
});

export const ensureEmailIndex = emailSearchService.ensureIndex;
export const indexEmailRecord = emailSearchService.indexEmail;
export const searchEmails = emailSearchService.search;
