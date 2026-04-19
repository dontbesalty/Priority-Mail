import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function migrate(): Promise<void> {
  const sql = fs.readFileSync(
    path.join(__dirname, "schema.sql"),
    "utf-8"
  );
  await pool.query(sql);
  console.log("✅  Database schema ready");
}
