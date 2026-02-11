import { testClient } from "hono/testing";
import { describe, it, expect, assert, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("GET /api/links/:id", () => {
  let db: InstanceType<typeof Database>;
  let client: ReturnType<typeof testClient<ReturnType<typeof createApp>>>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(schema);
    const app = createApp(db);
    client = testClient(app);
  });

  afterEach(() => {
    db.close();
  });

  it("should return a link by id", async () => {
    const createRes = await client.api.links.$post({
      json: { url: "https://example.com", slug: "my-link" },
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await client.api.links[":id"].$get({
      param: { id: created.id as string },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("id" in body);
    expect(body.id).toBe(created.id);
    expect(body.slug).toBe("my-link");
    expect(body.targetUrl).toBe("https://example.com");
    expect(body.hasPassword).toBe(false);
    expect(body.tags).toEqual([]);
    expect(body.shortUrl).toContain("my-link");
  });

  it("should return 404 for unknown id", async () => {
    const res = await client.api.links[":id"].$get({
      param: { id: "nonexistent" },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("NOT_FOUND");
  });
});
