import { Router, Request, Response } from "express";
import { pool } from "../db/client";

const router = Router();

// ── GET /tasks ────────────────────────────────────────────────────────────────
// List and filter tasks
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const values: any[] = [];
    let query = `
      SELECT t.*, e.subject as email_subject
      FROM tasks t
      LEFT JOIN emails e ON t.email_id = e.id
    `;

    if (status === "open" || status === "done") {
      query += ` WHERE t.status = $1`;
      values.push(status);
    }

    query += ` ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC`;

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err: any) {
    console.error("GET /tasks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /tasks ───────────────────────────────────────────────────────────────
// Create a new task
router.post("/", async (req: Request, res: Response) => {
  try {
    const { email_id, title, due_date } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    const result = await pool.query(
      `INSERT INTO tasks (email_id, title, due_date)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [email_id || null, title, due_date || null]
    );

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error("POST /tasks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /tasks/:id ──────────────────────────────────────────────────────────
// Update task details or status
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, title, due_date } = req.body;

    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (status) {
      fields.push(`status = $${i++}`);
      values.push(status);
    }
    if (title) {
      fields.push(`title = $${i++}`);
      values.push(title);
    }
    if (due_date !== undefined) {
      fields.push(`due_date = $${i++}`);
      values.push(due_date);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE tasks
       SET ${fields.join(", ")}, updated_at = NOW()
       WHERE id = $${i}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error("PATCH /tasks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /tasks/:id ─────────────────────────────────────────────────────────
// Remove a task
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM tasks WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({ ok: true, id: result.rows[0].id });
  } catch (err: any) {
    console.error("DELETE /tasks error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
