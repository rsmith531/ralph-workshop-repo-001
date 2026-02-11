import { Hono } from "hono";
import type Database from "better-sqlite3";
import { z } from "zod";
import { nanoid, customAlphabet } from "nanoid";
import bcrypt from "bcrypt";

const generateSlug = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 7);

const urlField = z
  .string()
  .url()
  .refine(
    (u) => u.startsWith("http://") || u.startsWith("https://"),
    "URL must use http or https"
  );

const slugField = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .min(3)
  .max(50);

const tagNameField = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .min(1)
  .max(30);

const createLinkSchema = z.object({
  url: urlField,
  slug: slugField.optional(),
  expiresAt: z.number().int().positive().optional(),
  password: z.string().min(4).optional(),
  tags: z.array(tagNameField).optional(),
});

const createTagSchema = z.object({
  name: tagNameField,
});

const updateLinkSchema = z.object({
  url: urlField.optional(),
  slug: slugField.optional(),
  expiresAt: z.number().int().positive().optional(),
  password: z.string().min(4).optional(),
  tags: z.array(tagNameField).optional(),
});

interface LinkRow {
  id: string;
  slug: string;
  target_url: string;
  password_hash: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

const LINK_SELECT =
  "SELECT id, slug, target_url, password_hash, expires_at, created_at, updated_at FROM links WHERE id = ?";

function formatLinkResponse(link: LinkRow, tags: { name: string }[]) {
  const baseUrl = process.env["BASE_URL"] || "http://localhost:3000";
  return {
    id: link.id,
    slug: link.slug,
    shortUrl: `${baseUrl}/${link.slug}`,
    targetUrl: link.target_url,
    expiresAt: link.expires_at,
    hasPassword: link.password_hash !== null,
    tags: tags.map((t) => t.name),
    createdAt: link.created_at,
    updatedAt: link.updated_at,
  };
}

export function createApp(db: Database.Database) {
  const TAGS_SELECT =
    "SELECT t.name FROM tags t JOIN link_tags lt ON t.id = lt.tag_id WHERE lt.link_id = ?";

  function syncTags(linkId: string, tagNames: string[]) {
    db.prepare("DELETE FROM link_tags WHERE link_id = ?").run(linkId);
    for (const name of tagNames) {
      let tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as
        | { id: string }
        | undefined;
      if (!tag) {
        const tagId = nanoid();
        db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(
          tagId,
          name
        );
        tag = { id: tagId };
      }
      db.prepare("INSERT INTO link_tags (link_id, tag_id) VALUES (?, ?)").run(
        linkId,
        tag.id
      );
    }
  }

  function getLinkWithTags(id: string) {
    const link = db.prepare(LINK_SELECT).get(id) as LinkRow | undefined;
    if (!link) return null;
    const tags = db.prepare(TAGS_SELECT).all(id) as { name: string }[];
    return formatLinkResponse(link, tags);
  }

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

      const {
        url,
        slug: customSlug,
        expiresAt,
        password,
        tags: tagNames,
      } = parsed.data;
      const id = nanoid();
      const slug = customSlug || generateSlug();
      const now = Date.now();
      const passwordHash = password ? await bcrypt.hash(password, 10) : null;

      try {
        db.prepare(
          "INSERT INTO links (id, slug, target_url, password_hash, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(id, slug, url, passwordHash, expiresAt ?? null, now, now);
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

      if (tagNames && tagNames.length > 0) {
        syncTags(id, tagNames);
      }

      const baseUrl = process.env["BASE_URL"] || "http://localhost:3000";

      return c.json(
        {
          id,
          slug,
          shortUrl: `${baseUrl}/${slug}`,
          targetUrl: url,
          expiresAt: expiresAt ?? null,
          hasPassword: passwordHash !== null,
          tags: tagNames ?? [],
          createdAt: now,
          updatedAt: now,
        },
        201
      );
    })
    .get("/api/links", (c) => {
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const limit = Math.max(
        1,
        Math.min(100, Number(c.req.query("limit")) || 20)
      );
      const offset = (page - 1) * limit;

      const { total } = db
        .prepare("SELECT COUNT(*) as total FROM links")
        .get() as { total: number };

      const rows = db
        .prepare(
          "SELECT id, slug, target_url, password_hash, expires_at, created_at, updated_at FROM links ORDER BY created_at DESC LIMIT ? OFFSET ?"
        )
        .all(limit, offset) as LinkRow[];

      const links = rows.map((row) => {
        const tags = db.prepare(TAGS_SELECT).all(row.id) as {
          name: string;
        }[];
        return formatLinkResponse(row, tags);
      });

      return c.json({
        links,
        pagination: {
          page,
          limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / limit),
        },
      });
    })
    .get("/api/links/:id", (c) => {
      const link = getLinkWithTags(c.req.param("id"));

      if (!link) {
        return c.json({ error: "Link not found", code: "NOT_FOUND" }, 404);
      }

      return c.json(link);
    })
    .patch("/api/links/:id", async (c) => {
      const id = c.req.param("id");
      const body = await c.req.json();
      const parsed = updateLinkSchema.safeParse(body);

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

      const existing = db
        .prepare("SELECT id FROM links WHERE id = ?")
        .get(id) as { id: string } | undefined;

      if (!existing) {
        return c.json({ error: "Link not found", code: "NOT_FOUND" }, 404);
      }

      const updates: string[] = [];
      const values: unknown[] = [];

      if (parsed.data.url !== undefined) {
        updates.push("target_url = ?");
        values.push(parsed.data.url);
      }

      if (parsed.data.slug !== undefined) {
        updates.push("slug = ?");
        values.push(parsed.data.slug);
      }

      if (parsed.data.expiresAt !== undefined) {
        updates.push("expires_at = ?");
        values.push(parsed.data.expiresAt);
      }

      if (parsed.data.password !== undefined) {
        const hash = await bcrypt.hash(parsed.data.password, 10);
        updates.push("password_hash = ?");
        values.push(hash);
      }

      if (updates.length > 0) {
        const now = Date.now();
        updates.push("updated_at = ?");
        values.push(now);
        values.push(id);

        try {
          db.prepare(`UPDATE links SET ${updates.join(", ")} WHERE id = ?`).run(
            ...values
          );
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
      }

      if (parsed.data.tags !== undefined) {
        syncTags(id, parsed.data.tags);
      }

      return c.json(getLinkWithTags(id));
    })
    .delete("/api/links/:id", (c) => {
      const id = c.req.param("id");

      const result = db.prepare("DELETE FROM links WHERE id = ?").run(id);

      if (result.changes === 0) {
        return c.json({ error: "Link not found", code: "NOT_FOUND" }, 404);
      }

      return c.body(null, 204);
    })
    .post("/api/tags", async (c) => {
      const body = await c.req.json();
      const parsed = createTagSchema.safeParse(body);

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

      const id = nanoid();

      try {
        db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(
          id,
          parsed.data.name
        );
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes("UNIQUE constraint failed: tags.name")
        ) {
          return c.json({ error: "Tag already exists", code: "CONFLICT" }, 409);
        }
        throw err;
      }

      return c.json({ id, name: parsed.data.name }, 201);
    })
    .get("/api/tags", (c) => {
      const tags = db
        .prepare(
          "SELECT t.id, t.name, COUNT(lt.link_id) as linkCount FROM tags t LEFT JOIN link_tags lt ON t.id = lt.tag_id GROUP BY t.id ORDER BY t.name"
        )
        .all() as { id: string; name: string; linkCount: number }[];

      return c.json({ tags });
    })
    .get("/:slug", async (c) => {
      const slug = c.req.param("slug");

      const link = db
        .prepare(
          "SELECT id, target_url, password_hash, expires_at FROM links WHERE slug = ?"
        )
        .get(slug) as
        | {
            id: string;
            target_url: string;
            password_hash: string | null;
            expires_at: number | null;
          }
        | undefined;

      if (!link) {
        return c.json({ error: "Link not found", code: "NOT_FOUND" }, 404);
      }

      if (link.expires_at && link.expires_at < Date.now()) {
        return c.json({ error: "Link expired", code: "GONE" }, 410);
      }

      if (link.password_hash) {
        const password = c.req.query("password");
        if (!password) {
          return c.json(
            { error: "Password required", code: "UNAUTHORIZED" },
            401
          );
        }
        const valid = await bcrypt.compare(password, link.password_hash);
        if (!valid) {
          return c.json(
            { error: "Password required", code: "UNAUTHORIZED" },
            401
          );
        }
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
