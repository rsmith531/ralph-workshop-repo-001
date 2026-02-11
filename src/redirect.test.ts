import { testClient } from "hono/testing";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "./app.js";
import { schema } from "./db/schema.js";

describe("GET /:slug", () => {
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

  it("should redirect to target URL", async () => {
    await client.api.links.$post({
      json: { url: "https://example.com", slug: "test-link" },
    });

    const res = await client[":slug"].$get({ param: { slug: "test-link" } });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com");
  });

  it("should return 404 for unknown slug", async () => {
    const res = await client[":slug"].$get({ param: { slug: "unknown" } });

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("should record a click on redirect", async () => {
    // Create a link
    const createRes = await client.api.links.$post({
      json: { url: "https://example.com", slug: "click-me" },
    });
    const link = (await createRes.json()) as Record<string, unknown>;

    // Visit the link
    await client[":slug"].$get({ param: { slug: "click-me" } });

    // Verify click was recorded by checking the clicks table directly
    // (no analytics endpoint yet, so this is the only way to verify)
    const click = db
      .prepare("SELECT * FROM clicks WHERE link_id = ?")
      .get(link.id as string) as Record<string, unknown> | undefined;

    expect(click).toBeDefined();
    expect(click!.link_id).toBe(link.id);
    expect(click!.timestamp).toBeTypeOf("number");
  });
});
