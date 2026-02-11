import { describe, it, expect, assert, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("Tags API", () => {
  let db: InstanceType<typeof Database>;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(schema);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  async function createTag(name: string) {
    return app.request("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  async function listTags() {
    return app.request("/api/tags");
  }

  it("should create a tag", async () => {
    const res = await createTag("marketing");

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    assert("id" in body);
    expect(body.name).toBe("marketing");
  });

  it("should reject duplicate tag names", async () => {
    await createTag("marketing");
    const res = await createTag("marketing");

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("CONFLICT");
  });

  it("should reject invalid tag names", async () => {
    const res = await createTag("INVALID TAG!");

    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("should return empty list when no tags exist", async () => {
    const res = await listTags();

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("tags" in body);
    expect(body.tags).toEqual([]);
  });

  it("should list created tags with linkCount", async () => {
    await createTag("marketing");
    await createTag("q1");

    const res = await listTags();

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    assert("tags" in body);
    const tags = body.tags as Record<string, unknown>[];
    expect(tags).toHaveLength(2);
    expect(tags[0]).toHaveProperty("linkCount", 0);
  });
});
