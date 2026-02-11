import { testClient } from "hono/testing";
import { describe, it, expect, assert, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("Tags in links", () => {
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

  it("should create a link with tags", async () => {
    const res = await createLink({
      url: "https://example.com",
      slug: "tagged-link",
      tags: ["marketing", "q1"],
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.tags).toEqual(["marketing", "q1"]);
  });

  it("should return tags when getting a link by id", async () => {
    const createRes = await createLink({
      url: "https://example.com",
      slug: "get-tagged",
      tags: ["marketing"],
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const getRes = await client.api.links[":id"].$get({
      param: { id: created.id as string },
    });

    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as Record<string, unknown>;
    assert("tags" in body);
    expect(body.tags).toEqual(["marketing"]);
  });

  it("should update tags via PATCH", async () => {
    const createRes = await createLink({
      url: "https://example.com",
      slug: "patch-tags",
      tags: ["old-tag"],
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const patchRes = await patchLink(created.id as string, {
      tags: ["new-tag", "another"],
    });

    expect(patchRes.status).toBe(200);
    const body = (await patchRes.json()) as Record<string, unknown>;
    assert("tags" in body);
    const tags = body.tags as string[];
    expect(tags).toHaveLength(2);
    expect(tags).toContain("new-tag");
    expect(tags).toContain("another");
    expect(tags).not.toContain("old-tag");
  });

  it("should auto-create tags that don't exist", async () => {
    const res = await createLink({
      url: "https://example.com",
      slug: "auto-tags",
      tags: ["brand-new-tag"],
    });

    expect(res.status).toBe(201);

    // Verify the tag shows up in GET /api/tags
    const tagsRes = await app.request("/api/tags");
    const tagsBody = (await tagsRes.json()) as Record<string, unknown>;
    assert("tags" in tagsBody);
    const tags = tagsBody.tags as Record<string, unknown>[];
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("brand-new-tag");
    expect(tags[0]!.linkCount).toBe(1);
  });
});
