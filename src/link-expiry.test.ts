import { testClient } from "hono/testing";
import { describe, it, expect, assert, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("Link expiry", () => {
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

  async function createLink(body: Record<string, unknown>) {
    return app.request("/api/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function patchLink(id: string, body: Record<string, unknown>) {
    return app.request(`/api/links/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("should store expiresAt when creating a link", async () => {
    const futureTime = Date.now() + 60_000;
    const res = await createLink({
      url: "https://example.com",
      slug: "expiring",
      expiresAt: futureTime,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.expiresAt).toBe(futureTime);
  });

  it("should return 410 GONE for expired links on redirect", async () => {
    const pastTime = Date.now() - 60_000;
    const createRes = await createLink({
      url: "https://example.com",
      slug: "expired-link",
      expiresAt: pastTime,
    });
    expect(createRes.status).toBe(201);

    const res = await client[":slug"].$get({
      param: { slug: "expired-link" },
    });

    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("GONE");
  });

  it("should still redirect non-expired links", async () => {
    const futureTime = Date.now() + 60_000;
    const createRes = await createLink({
      url: "https://example.com",
      slug: "still-valid",
      expiresAt: futureTime,
    });
    expect(createRes.status).toBe(201);

    const res = await client[":slug"].$get({
      param: { slug: "still-valid" },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com");
  });

  it("should update expiresAt via PATCH", async () => {
    const createRes = await createLink({
      url: "https://example.com",
      slug: "patch-expiry",
    });
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.expiresAt).toBeNull();

    const futureTime = Date.now() + 60_000;
    const patchRes = await patchLink(created.id as string, {
      expiresAt: futureTime,
    });

    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.expiresAt).toBe(futureTime);
  });
});
