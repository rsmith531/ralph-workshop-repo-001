import { testClient } from "hono/testing";
import { describe, it, expect, assert, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("PATCH /api/links/:id", () => {
  let db: InstanceType<typeof Database>;
  let app: ReturnType<typeof createApp>;
  let client: ReturnType<typeof testClient<ReturnType<typeof createApp>>>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(schema);
    app = createApp(db);
    client = testClient(app);
  });

  afterEach(() => {
    db.close();
  });

  async function patchLink(id: string, body: Record<string, unknown>) {
    return app.request(`/api/links/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("should update the target URL", async () => {
    const createRes = await client.api.links.$post({
      json: { url: "https://example.com", slug: "update-me" },
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await patchLink(created.id as string, {
      url: "https://new-url.com",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("targetUrl" in body);
    expect(body.targetUrl).toBe("https://new-url.com");
    expect(body.slug).toBe("update-me");
  });

  it("should update the slug", async () => {
    const createRes = await client.api.links.$post({
      json: { url: "https://example.com", slug: "old-slug" },
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await patchLink(created.id as string, { slug: "new-slug" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("slug" in body);
    expect(body.slug).toBe("new-slug");
    expect(body.shortUrl).toContain("new-slug");
  });

  it("should return 404 for unknown id", async () => {
    const res = await patchLink("nonexistent", {
      url: "https://example.com",
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should reject duplicate slug", async () => {
    await client.api.links.$post({
      json: { url: "https://example.com", slug: "taken-slug" },
    });

    const createRes = await client.api.links.$post({
      json: { url: "https://other.com", slug: "my-slug" },
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await patchLink(created.id as string, {
      slug: "taken-slug",
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("CONFLICT");
  });

  it("should reject invalid URL", async () => {
    const createRes = await client.api.links.$post({
      json: { url: "https://example.com", slug: "validate-me" },
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await patchLink(created.id as string, { url: "not-a-url" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should persist updates visible via GET", async () => {
    const createRes = await client.api.links.$post({
      json: { url: "https://example.com", slug: "persist-test" },
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    await patchLink(created.id as string, {
      url: "https://updated.com",
      slug: "new-persist",
    });

    const getRes = await client.api.links[":id"].$get({
      param: { id: created.id as string },
    });

    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as Record<string, unknown>;
    assert("targetUrl" in body);
    expect(body.targetUrl).toBe("https://updated.com");
    expect(body.slug).toBe("new-persist");
  });
});
