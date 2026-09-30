import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { test } from "node:test";
import { createSearchRouter } from "./search.js";

test("GET /api/search/emails accepts q and returns search results", async () => {
  const app = express();
  const requestedQueries: string[] = [];
  app.use(
    "/api/search",
    createSearchRouter(async (query) => {
      requestedQueries.push(query);
      return [{
        id: "email-1",
        emailId: "email-1",
        campaignId: "campaign-1",
        recipient: "ada@example.test",
        subject: "Launch details",
        body: "The launch is ready",
        status: "SENT",
        scheduledAt: "2030-01-01T00:00:00.000Z",
        sentAt: "2030-01-01T00:01:00.000Z",
      }];
    }),
  );

  const server: Server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api/search/emails`;
    const invalidResponse = await fetch(baseUrl);
    assert.equal(invalidResponse.status, 400);

    const response = await fetch(`${baseUrl}?q=%20launch%20`);
    assert.equal(response.status, 200);
    assert.equal(requestedQueries[0], "launch");
    const result = (await response.json()) as { results: Array<{ emailId: string }> };
    assert.equal(result.results[0]?.emailId, "email-1");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});