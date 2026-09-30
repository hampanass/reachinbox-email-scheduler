import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEmailSearchService,
  EMAIL_INDEX,
  type EmailIndexDocument,
  type EmailSearchClient,
} from "./emailSearch.js";

test("search creates the email index and searches recipient, subject, and body", async () => {
  let createdIndex: unknown;
  let searchRequest: unknown;
  const document: EmailIndexDocument = {
    emailId: "email-1",
    campaignId: "campaign-1",
    recipient: "ada@example.test",
    subject: "Project update",
    body: "The launch is ready",
    status: "SCHEDULED",
    scheduledAt: "2030-01-01T00:00:00.000Z",
    sentAt: null,
  };
  const client = {
    indices: {
      exists: async () => false,
      create: async (request: unknown) => {
        createdIndex = request;
      },
    },
    index: async () => ({ result: "created" }),
    search: async (request: unknown) => {
      searchRequest = request;
      return { hits: { hits: [{ _id: document.emailId, _source: document }] } };
    },
  } as unknown as EmailSearchClient;
  const service = createEmailSearchService(client);

  const results = await service.search("launch");

  assert.deepEqual(createdIndex, {
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
  assert.deepEqual(searchRequest, {
    index: EMAIL_INDEX,
    size: 50,
    query: {
      multi_match: {
        query: "launch",
        fields: ["recipient", "subject", "body"],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    },
    sort: [{ scheduledAt: { order: "desc" } }],
  });
  assert.deepEqual(results, [{ id: "email-1", ...document }]);
});

test("indexing failures are contained and reported without throwing", async () => {
  const client = {
    indices: {
      exists: async () => {
        throw new Error("Elasticsearch is offline");
      },
      create: async () => undefined,
    },
    index: async () => undefined,
    search: async () => ({ hits: { hits: [] } }),
  } as unknown as EmailSearchClient;
  const service = createEmailSearchService(client);

  const indexed = await service.indexEmail({
    emailId: "email-offline",
    campaignId: "campaign-1",
    recipient: "ada@example.test",
    subject: "Project update",
    body: "Message body",
    status: "SENT",
    scheduledAt: "2030-01-01T00:00:00.000Z",
    sentAt: "2030-01-01T00:01:00.000Z",
  });

  assert.equal(indexed, false);
});
