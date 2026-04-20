import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { migrate } from "./db/client";
import { cleanupOldEmails } from "./db/cleanup";
import emailsRouter from "./routes/emails";
import tasksRouter from "./routes/tasks";
import logsRouter from "./routes/logs";

const app = express();
const PORT = parseInt(process.env.PORT ?? "4000", 10);

app.use(cors());
app.use(express.json({ limit: "10mb" })); // ingest can be large

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/emails", emailsRouter);
app.use("/tasks", tasksRouter);
app.use("/logs", logsRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  // Wait for Postgres (Docker compose starts it first, but give it a moment)
  const maxRetries = 10;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await migrate();
      break;
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      console.log(`⏳  Waiting for database… (attempt ${attempt}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀  Backend API running on port ${PORT}`);
  });

  // ── Retention Policy Cleanup ────────────────────────────────────────────────
  // Run once on startup, then every hour
  const ONE_HOUR = 60 * 60 * 1000;
  cleanupOldEmails().catch((err) => console.error("Initial cleanup failed:", err));
  setInterval(() => {
    cleanupOldEmails().catch((err) => console.error("Scheduled cleanup failed:", err));
  }, ONE_HOUR);
}

start().catch((err) => {
  console.error("❌  Failed to start:", err.message ?? err);
  process.exit(1);
});
