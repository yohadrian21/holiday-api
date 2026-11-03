import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Insert the real seed data (if any JSON files exist), mirroring seed/seed.sql.
const stmts: D1PreparedStatement[] = [];
for (const { version: v, holidays } of env.TEST_SEED) {
  stmts.push(env.DB.prepare("DELETE FROM holidays WHERE year = ?").bind(v.year));
  stmts.push(env.DB.prepare("DELETE FROM data_versions WHERE year = ?").bind(v.year));
  stmts.push(
    env.DB.prepare("INSERT INTO data_versions (version, year, source_ref, source_url, updated_at, notes) VALUES (?, ?, ?, ?, ?, ?)").bind(
      v.version, v.year, v.source_ref, v.source_url, v.updated_at, v.notes,
    ),
  );
  for (const h of holidays) {
    stmts.push(
      env.DB.prepare(
        "INSERT INTO holidays (date, year, name_id, name_en, type, source_ref, source_url, data_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(h.date, h.year, h.name_id, h.name_en, h.type, h.source_ref, h.source_url, h.data_version),
    );
  }
}
if (stmts.length) await env.DB.batch(stmts);
