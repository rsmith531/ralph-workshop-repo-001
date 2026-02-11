import { Hono } from "hono";
import type Database from "better-sqlite3";
import { z } from "zod";
import { nanoid, customAlphabet } from "nanoid";

const generateSlug = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 7);

const createLinkSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith("http://") || u.startsWith("https://"),
      "URL must use http or https"
    ),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(3)
    .max(50)
    .optional(),
});

export function createApp(db: Database.Database) {
  return new Hono()
    .get("/api/health", (c) => {
      return c.json({ status: "ok" });
    })
    .post("/api/links", async (c) => {
      const body = await c.req.json();
      const parsed = createLinkSchema.safeParse(body);

      if (!parsed.success) {
        return c.json(
          {
            error: "Invalid request",
            code: "VALIDATION_ERROR",
            details: parsed.error.issues,
          },
          400
        );
      }

      const { url, slug: customSlug } = parsed.data;
      const id = nanoid();
      const slug = customSlug || generateSlug();
      const now = Date.now();

      try {
        db.prepare(
          "INSERT INTO links (id, slug, target_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(id, slug, url, now, now);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes("UNIQUE constraint failed: links.slug")
        ) {
          return c.json(
            { error: "Slug already exists", code: "CONFLICT" },
            409
          );
        }
        throw err;
      }

      const baseUrl = process.env["BASE_URL"] || "http://localhost:3000";

      return c.json(
        {
          id,
          slug,
          shortUrl: `${baseUrl}/${slug}`,
          targetUrl: url,
          expiresAt: null,
          hasPassword: false,
          tags: [],
          createdAt: now,
          updatedAt: now,
        },
        201
      );
    })
    .get("/api/links/:id", (c) => {
      const id = c.req.param("id");

      const link = db
        .prepare(
          "SELECT id, slug, target_url, password_hash, expires_at, created_at, updated_at FROM links WHERE id = ?"
        )
        .get(id) as
        | {
            id: string;
            slug: string;
            target_url: string;
            password_hash: string | null;
            expires_at: number | null;
            created_at: number;
            updated_at: number;
          }
        | undefined;

      if (!link) {
        return c.json({ error: "Link not found", code: "NOT_FOUND" }, 404);
      }

      const tags = db
        .prepare(
          "SELECT t.name FROM tags t JOIN link_tags lt ON t.id = lt.tag_id WHERE lt.link_id = ?"
        )
        .all(id) as { name: string }[];

      const baseUrl = process.env["BASE_URL"] || "http://localhost:3000";

      return c.json({
        id: link.id,
        slug: link.slug,
        shortUrl: `${baseUrl}/${link.slug}`,
        targetUrl: link.target_url,
        expiresAt: link.expires_at,
        hasPassword: link.password_hash !== null,
        tags: tags.map((t) => t.name),
        createdAt: link.created_at,
        updatedAt: link.updated_at,
      });
    })
    .delete("/api/links/:id", (c) => {
      const id = c.req.param("id");

      const result = db.prepare("DELETE FROM links WHERE id = ?").run(id);

      if (result.changes === 0) {
        return c.json({ error: "Link not found", code: "NOT_FOUND" }, 404);
      }

      return c.body(null, 204);
    })
    .get("/:slug", (c) => {
      const slug = c.req.param("slug");

      const link = db
        .prepare("SELECT id, target_url FROM links WHERE slug = ?")
        .get(slug) as { id: string; target_url: string } | undefined;

      if (!link) {
        return c.json({ error: "Link not found", code: "NOT_FOUND" }, 404);
      }

      // Record click
      db.prepare(
        "INSERT INTO clicks (id, link_id, timestamp, ip, user_agent, referrer) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(
        nanoid(),
        link.id,
        Date.now(),
        c.req.header("x-forwarded-for") || null,
        c.req.header("user-agent") || null,
        c.req.header("referer") || null
      );

      return c.redirect(link.target_url, 302);
    });
}
