import { Router, Request, Response } from "express";
import { pool } from "../db/client";
import { sendPushoverNotification } from "../notifications/pushover";

const router = Router();

// ── Pushover Config ──────────────────────────────────────────────────────────
const pushoverConfig = process.env.PUSHOVER_APP_TOKEN
  ? {
      appToken: process.env.PUSHOVER_APP_TOKEN,
      userKey: process.env.PUSHOVER_USER_KEY ?? "",
      frontendUrl: process.env.PUSHOVER_FRONTEND_URL,
      notifyPriority: process.env.PUSHOVER_NOTIFY_PRIORITY ?? "High",
      graceMins: parseInt(process.env.PUSHOVER_GRACE_PERIOD_MINUTES ?? "15", 10),
    }
  : null;

// ── GET /emails ───────────────────────────────────────────────────────────────
// List triaged emails sorted by priority then date.
// Optional query params: ?priority=High&actioned=false&source=gmail
router.get("/", async (req: Request, res: Response) => {
  try {
    const { priority, actioned, source } = req.query;
    const conditions: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (priority) {
      conditions.push(`priority = $${i++}`);
      values.push(priority);
    }
    if (actioned === "false") {
      conditions.push(`user_action IS NULL`);
    }
    if (source) {
      conditions.push(`source = $${i++}`);
      values.push(source);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT id, thread_id, subject, from_address, to_address, received_at,
              snippet, labels, is_unread,
              priority, category, priority_reason, reply_needed, task_needed,
              task_title, due_date_guess, confidence, rule_fired, classified_by,
              source, account_email,
              user_action, user_category, actioned_at, created_at
       FROM emails
       ${where}
       ORDER BY
         CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
         received_at DESC
       LIMIT 100`,
      values
    );

    res.json(result.rows);
  } catch (err: any) {
    console.error("GET /emails error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /emails/latest-id ─────────────────────────────────────────────────────
// Returns the most recently received email ID for a given source.
router.get("/latest-id", async (req: Request, res: Response) => {
  try {
    const { source } = req.query;
    if (!source) {
      return res.status(400).json({ error: "source is required" });
    }

    const result = await pool.query(
      "SELECT id FROM emails WHERE source = $1 ORDER BY received_at DESC LIMIT 1",
      [source]
    );

    if (result.rows.length === 0) {
      return res.json({ id: null });
    }

    res.json({ id: result.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /emails/:id ───────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM emails WHERE id = $1",
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /emails/ingest ───────────────────────────────────────────────────────
// Connector POSTs an array of TriagedEmail objects here.
router.post("/ingest", async (req: Request, res: Response) => {
  const emails: any[] = req.body;
  if (!Array.isArray(emails)) {
    return res.status(400).json({ error: "Body must be an array of TriagedEmail" });
  }

  let upserted = 0;
  for (const e of emails) {
    try {
      const c = e.classification ?? {};
      await pool.query(
        `INSERT INTO emails (
          id, thread_id, subject, from_address, to_address, received_at,
          body, snippet, labels, is_unread,
          priority, category, priority_reason, reply_needed, task_needed,
          task_title, due_date_guess, reply_draft, confidence, rule_fired, classified_by,
          source, account_email
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
          $22,$23
        )
        ON CONFLICT (id) DO UPDATE SET
          priority        = EXCLUDED.priority,
          category        = EXCLUDED.category,
          priority_reason = EXCLUDED.priority_reason,
          reply_needed    = EXCLUDED.reply_needed,
          task_needed     = EXCLUDED.task_needed,
          task_title      = EXCLUDED.task_title,
          due_date_guess  = EXCLUDED.due_date_guess,
          reply_draft     = EXCLUDED.reply_draft,
          confidence      = EXCLUDED.confidence,
          rule_fired      = EXCLUDED.rule_fired,
          classified_by   = EXCLUDED.classified_by,
          source          = EXCLUDED.source,
          account_email   = EXCLUDED.account_email,
          updated_at      = NOW()`,
        [
          e.id, e.threadId, e.subject, e.from, e.to,
          e.date ? new Date(e.date) : null,
          e.body, e.snippet, e.labels, e.isUnread,
          c.priority, c.category, c.priority_reason,
          c.reply_needed, c.task_needed,
          c.task_title ?? null,
          c.due_date_guess ?? null,
          c.reply_draft ?? null,
          c.confidence,
          e.rule_fired ?? null,
          e.classified_by ?? null,
          e.source ?? "gmail",
          e.accountEmail ?? "",
        ]
      );
      upserted++;
    } catch (err: any) {
      console.error(`Failed to upsert email ${e.id}:`, err.message);
    }
  }

  res.json({ upserted });

  // ── Trigger Pushover Notifications ─────────────────────────────────────────
  if (pushoverConfig) {
    try {
      // 1. Collect ALL un-notified emails meeting the priority threshold
      // This catches emails from the current batch AND those held by previous grace windows
      const pendingResult = await pool.query(
        `SELECT id, subject, from_address, category, priority_reason
         FROM emails
         WHERE priority = $1 AND notified_pushover_at IS NULL AND user_action IS NULL`,
        [pushoverConfig.notifyPriority]
      );
      const pending = pendingResult.rows;

      if (pending.length > 0) {
        // 2. Grace period check: has ANY notification been sent recently?
        const graceResult = await pool.query(
          `SELECT 1 FROM emails
           WHERE notified_pushover_at > NOW() - INTERVAL '${pushoverConfig.graceMins} minutes'
           LIMIT 1`
        );

        if (graceResult.rows.length === 0) {
          // 3. Grace window clear — fire ONE batched notification
          console.log(`[Pushover] Sending notification for ${pending.length} emails...`);
          await sendPushoverNotification(pending, {
            appToken: pushoverConfig.appToken,
            userKey: pushoverConfig.userKey,
            frontendUrl: pushoverConfig.frontendUrl,
          });

          // 4. Mark them as notified
          const pendingIds = pending.map((e) => e.id);
          await pool.query(
            `UPDATE emails SET notified_pushover_at = NOW() WHERE id = ANY($1)`,
            [pendingIds]
          );
        } else {
          console.log(`[Pushover] Grace period active, holding ${pending.length} emails.`);
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ Pushover notification failed: ${err.message}`);
    }
  }
});

// ── POST /emails/:id/action ───────────────────────────────────────────────────
// Record user action: approved | dismissed | corrected
router.post("/:id/action", async (req: Request, res: Response) => {
  const { action, category } = req.body as {
    action: "approved" | "dismissed" | "corrected";
    category?: string;
  };

  if (!["approved", "dismissed", "corrected"].includes(action)) {
    return res.status(400).json({ error: "action must be approved|dismissed|corrected" });
  }

  try {
    const result = await pool.query(
      `UPDATE emails
       SET user_action = $1, user_category = $2, actioned_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING id`,
      [action, category ?? null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Email not found" });
    }

    res.json({ ok: true, id: result.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
