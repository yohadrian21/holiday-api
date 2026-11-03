/** Generates seed/seed.sql from data/holidays/<year>.json. Usage: tsx scripts/build-seed.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadSeedYears, toSql } from "./lib/seed.ts";

const years = loadSeedYears("data/holidays");
mkdirSync("seed", { recursive: true });
writeFileSync("seed/seed.sql", toSql(years));
const total = years.reduce((n, y) => n + y.holidays.length, 0);
console.log(`seed/seed.sql: ${years.length} year(s) [${years.map((y) => y.version.year).join(", ")}], ${total} holidays`);
if (years.length === 0) console.warn("No data/holidays/<year>.json files found; seed is empty.");
