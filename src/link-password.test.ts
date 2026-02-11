import { testClient } from "hono/testing";
import { describe, it, expect, assert, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("Link password protection", () => {
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

  it("should create a link with hasPassword true when password provided", async () => {
    const res = await createLink({
      url: "https://example.com",
      slug: "secret-link",
      password: "mysecret",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.hasPassword).toBe(true);
  });

  it("should return 401 when redirecting to password-protected link without password", async () => {
    await createLink({
      url: "https://example.com",
      slug: "protected",
      password: "mysecret",
    });

    const res = await client[":slug"].$get({
      param: { slug: "protected" },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("should redirect when correct password is provided", async () => {
    await createLink({
      url: "https://example.com",
      slug: "unlockable",
      password: "mysecret",
    });

    const res = await app.request("/unlockable?password=mysecret");

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com");
  });

  it("should return 401 when wrong password is provided", async () => {
    await createLink({
      url: "https://example.com",
      slug: "wrong-pass",
      password: "mysecret",
    });

    const res = await app.request("/wrong-pass?password=wrongone");

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("should add password to existing link via PATCH", async () => {
    const createRes = await createLink({
      url: "https://example.com",
      slug: "add-pass",
    });
    const created = (await createRes.json()) as Record<string, unknown>;
    expect(created.hasPassword).toBe(false);

    const patchRes = await patchLink(created.id as string, {
      password: "newsecret",
    });

    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.hasPassword).toBe(true);

    // Verify redirect now requires password
    const redirectRes = await client[":slug"].$get({
      param: { slug: "add-pass" },
    });
    expect(redirectRes.status).toBe(401);
  });
});
