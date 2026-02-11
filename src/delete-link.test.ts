import { testClient } from "hono/testing";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("DELETE /api/links/:id", () => {
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

  it("should delete a link and return 204", async () => {
    const createRes = await client.api.links.$post({
      json: { url: "https://example.com", slug: "delete-me" },
    });
    const created = (await createRes.json()) as Record<string, unknown>;

    const res = await client.api.links[":id"].$delete({
      param: { id: created.id as string },
    });

    expect(res.status).toBe(204);

    // Verify link is gone
    const getRes = await client.api.links[":id"].$get({
      param: { id: created.id as string },
    });
    expect(getRes.status).toBe(404);
  });

  it("should return 404 for unknown id", async () => {
    const res = await client.api.links[":id"].$delete({
      param: { id: "nonexistent" },
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("NOT_FOUND");
  });
});
