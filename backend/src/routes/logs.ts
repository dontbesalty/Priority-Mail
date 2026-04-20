import { Router } from "express";
import { pool } from "../db/client";

const router = Router();

// GET /logs - Fetch all logs, sorted by timestamp desc
router.get("/", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const result = await pool.query(
      "SELECT * FROM logs ORDER BY timestamp DESC LIMIT $1",
      [limit]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /logs - Insert a new log entry
router.post("/", async (req, res) => {
  const { level, source, message, metadata } = req.body;
  if (!source || !message) {
    return res.status(400).json({ error: "source and message are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO logs (level, source, message, metadata) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [level || 'info', source, message, metadata || {}]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
