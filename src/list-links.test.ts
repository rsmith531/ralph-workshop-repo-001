import { testClient } from "hono/testing";
import { describe, it, expect, assert, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("GET /api/links", () => {
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

  it("should return an empty list when no links exist", async () => {
    const res = await client.api.links.$get();

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("links" in body);
    expect(body.links).toEqual([]);
    assert("pagination" in body);
    const pagination = body.pagination as Record<string, unknown>;
    expect(pagination.total).toBe(0);
    expect(pagination.totalPages).toBe(0);
  });

  it("should return created links", async () => {
    await client.api.links.$post({
      json: { url: "https://example.com", slug: "link-one" },
    });
    await client.api.links.$post({
      json: { url: "https://other.com", slug: "link-two" },
    });

    const res = await client.api.links.$get();

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("links" in body);
    const links = body.links as Record<string, unknown>[];
    expect(links).toHaveLength(2);
    const pagination = body.pagination as Record<string, unknown>;
    expect(pagination.total).toBe(2);
  });

  it("should paginate results", async () => {
    for (let i = 0; i < 5; i++) {
      await client.api.links.$post({
        json: { url: `https://example${i}.com` },
      });
    }

    const res = await client.api.links.$get({
      query: { page: "1", limit: "2" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("links" in body);
    const links = body.links as Record<string, unknown>[];
    expect(links).toHaveLength(2);
    const pagination = body.pagination as Record<string, unknown>;
    expect(pagination.page).toBe(1);
    expect(pagination.limit).toBe(2);
    expect(pagination.total).toBe(5);
    expect(pagination.totalPages).toBe(3);
  });

  it("should return second page of results", async () => {
    for (let i = 0; i < 5; i++) {
      await client.api.links.$post({
        json: { url: `https://example${i}.com` },
      });
    }

    const res = await client.api.links.$get({
      query: { page: "2", limit: "2" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("links" in body);
    const links = body.links as Record<string, unknown>[];
    expect(links).toHaveLength(2);
    const pagination = body.pagination as Record<string, unknown>;
    expect(pagination.page).toBe(2);
  });

  it("should default to page 1 and limit 20", async () => {
    await client.api.links.$post({
      json: { url: "https://example.com", slug: "default-test" },
    });

    const res = await client.api.links.$get();

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const pagination = body.pagination as Record<string, unknown>;
    expect(pagination.page).toBe(1);
    expect(pagination.limit).toBe(20);
  });
});
