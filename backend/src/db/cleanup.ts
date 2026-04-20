import { pool } from "./client";

/**
 * Purges emails based on priority-based retention periods:
 * - Low priority: 48 hours
 * - Medium priority: 1 week
 * - High priority: 1 month
 * 
 * Returns the total number of emails deleted.
 */
export async function cleanupOldEmails(): Promise<number> {
  const query = `
    DELETE FROM emails 
    WHERE 
      (priority = 'Low' AND received_at < NOW() - INTERVAL '48 hours') OR
      (priority = 'Medium' AND received_at < NOW() - INTERVAL '1 week') OR
      (priority = 'High' AND received_at < NOW() - INTERVAL '1 month') OR
      (priority IS NULL AND received_at < NOW() - INTERVAL '48 hours')
    RETURNING id
  `;

  const result = await pool.query(query);
  const count = result.rowCount ?? 0;
  
  if (count > 0) {
    await pool.query(
      "INSERT INTO logs (level, source, message) VALUES ($1, $2, $3)",
      ["info", "system", `🧹 Cleaned up ${count} old emails (Retention: Low/48h, Med/1w, High/1m).`]
    );
  }
  
  return count;
}
