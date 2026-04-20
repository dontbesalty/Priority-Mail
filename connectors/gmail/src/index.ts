/**
 * index.ts
 *
 * Entry point for the Gmail connector + triage pipeline.
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { fetchEmails } from "./gmail-connector";
import { triageBatch, TriagedEmail } from "./triage-pipeline";

dotenv.config();

const OUTPUT_DIR = path.join(__dirname, "..", "output");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "triaged.json");

function printSummary(emails: TriagedEmail[]): void {
  const hi = emails.filter((e) => e.classification.priority === "High").length;
  const med = emails.filter((e) => e.classification.priority === "Medium").length;
  const lo = emails.filter((e) => e.classification.priority === "Low").length;

  console.log("\n══════════════════════════════════════════════════════");
  console.log(`  📧  ${emails.length} email(s) triaged`);
  console.log(`  🔴  High: ${hi}   🟡  Medium: ${med}   ⚪  Low: ${lo}`);
  console.log("══════════════════════════════════════════════════════\n");

  for (const email of emails.filter((e) => e.classification.priority !== "Low")) {
    const c = email.classification;
    const p = c.priority === "High" ? "🔴" : "🟡";
    console.log(`${p}  ${email.subject.slice(0, 65)}`);
    console.log(`     From    : ${email.from}`);
    console.log(`     Category: ${c.category}`);
    console.log(`     Reason  : ${c.priority_reason}`);
    if (c.task_needed && c.task_title) {
      console.log(`     Task    : ${c.task_title}`);
    }
    console.log();
  }
}

function writeOutput(emails: TriagedEmail[]): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(emails, null, 2), "utf-8");
  console.log(`💾  Full output: ${OUTPUT_FILE}`);
}

async function postToBackend(emails: TriagedEmail[]): Promise<void> {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) return;

  try {
    const res = await fetch(`${backendUrl}/emails/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emails),
    });
    if (res.ok) {
      console.log(`✅  Sent ${emails.length} emails to backend (${backendUrl})`);
    } else {
      console.warn(`⚠️   Backend responded ${res.status} — check backend logs`);
    }
  } catch (err: any) {
    console.warn(`⚠️   Could not reach backend: ${err.message}`);
  }
}

async function logCompletion(
  emails: TriagedEmail[],
  durationMs: number
): Promise<void> {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) return;

  const durationSec = (durationMs / 1000).toFixed(1);
  try {
    await fetch(`${backendUrl}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "info",
        source: "gmail-connector",
        message: `Connector run completed: ${emails.length} emails triaged in ${durationSec}s`,
        metadata: {
          count: emails.length,
          duration_ms: durationMs,
          duration_sec: parseFloat(durationSec),
        },
      }),
    });
  } catch (err) {
    // Silent fail for logs
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getLatestId(): Promise<string | null> {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) return null;

  try {
    const res = await fetch(`${backendUrl}/emails/latest-id?source=gmail`);
    if (res.ok) {
      const data = (await res.json()) as { id: string | null };
      return data.id;
    }
  } catch (err) {
    // Silent fail, fallback to null
  }
  return null;
}

async function main({ fetchLimit }: { fetchLimit?: number } = {}): Promise<void> {
  const startTime = Date.now();
  try {
    const aiDelay = process.env.AI_CALL_DELAY_MS
      ? parseInt(process.env.AI_CALL_DELAY_MS, 10)
      : 0;
    const concurrency = aiDelay > 0 ? 1 : 3;

    const limit = fetchLimit ?? (process.env.FETCH_LIMIT ? parseInt(process.env.FETCH_LIMIT, 10) : 20);

    const latestId = await getLatestId();
    const emails = await fetchEmails(limit, { stopAtId: latestId });
    let triaged: TriagedEmail[] = [];

    if (emails.length === 0) {
      console.log("✅  No unread emails to process.");
    } else {
      console.log("\n🔍  Running triage pipeline…\n");
      triaged = await triageBatch(emails, {
        concurrency,
        aiCallDelayMs: aiDelay,
      });

      printSummary(triaged);
      writeOutput(triaged);
      await postToBackend(triaged);
    }

    const durationMs = Date.now() - startTime;
    await logCompletion(triaged, durationMs);
  } catch (err: any) {
    console.error("\n❌  Error:", err.message ?? err);
    if (!process.env.POLL_INTERVAL_SECONDS) {
      process.exit(1);
    }
  }
}

async function run(): Promise<void> {
  const pollIntervalSec = process.env.POLL_INTERVAL_SECONDS
    ? parseInt(process.env.POLL_INTERVAL_SECONDS, 10)
    : null;

  if (!pollIntervalSec) {
    await main();
    return;
  }

  console.log(`⏱️  Polling mode: running every ${pollIntervalSec}s`);

  let isFirstRun = true;
  while (true) {
    const fetchLimit = isFirstRun
      ? (process.env.FETCH_LIMIT ? parseInt(process.env.FETCH_LIMIT, 10) : 20)
      : (process.env.POLL_FETCH_LIMIT ? parseInt(process.env.POLL_FETCH_LIMIT, 10) : 5);

    await main({ fetchLimit });
    isFirstRun = false;

    console.log(`\n💤  Next poll in ${pollIntervalSec}s…`);
    await sleep(pollIntervalSec * 1000);
  }
}

run().catch(err => {
  console.error("❌  Fatal error:", err.message ?? err);
  process.exit(1);
});
