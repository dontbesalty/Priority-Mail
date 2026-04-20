/**
 * index.ts — O365 connector entry point
 *
 * Flow:
 *   1. Fetch unread emails from Outlook via Microsoft Graph API
 *   2. Run Rules Engine (fast, free pre-classification)
 *   3. Run AI Classifier for emails that need it (OpenRouter / local AI)
 *   4. Sort by priority
 *   5. Print summary to console
 *   6. Write output/triaged.json (always)
 *   7. POST to backend API if BACKEND_URL is set (Docker stack mode)
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { fetchEmails } from "./o365-connector";
import { triageBatch, TriagedEmail } from "./triage-pipeline";

dotenv.config();

const OUTPUT_DIR = path.join(__dirname, "..", "output");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "triaged.json");

function printSummary(emails: TriagedEmail[]): void {
  const hi = emails.filter((e) => e.classification.priority === "High").length;
  const med = emails.filter((e) => e.classification.priority === "Medium").length;
  const lo = emails.filter((e) => e.classification.priority === "Low").length;

  console.log("\n══════════════════════════════════════════════════════");
  console.log(`  📧  ${emails.length} Outlook email(s) triaged`);
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
      console.log(`✅  Sent ${emails.length} Outlook emails to backend (${backendUrl})`);
      // Log successful run
      await fetch(`${backendUrl}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: "info",
          source: "o365-connector",
          message: `Connector run completed: ${emails.length} emails triaged`,
          metadata: { count: emails.length }
        }),
      }).catch(() => {});
    } else {
      console.warn(`⚠️   Backend responded ${res.status} — check backend logs`);
    }
  } catch (err: any) {
    console.warn(`⚠️   Could not reach backend: ${err.message}`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main({ fetchLimit }: { fetchLimit?: number } = {}): Promise<void> {
  try {
    const aiDelay = process.env.AI_CALL_DELAY_MS
      ? parseInt(process.env.AI_CALL_DELAY_MS, 10)
      : 0;
    const concurrency = aiDelay > 0 ? 1 : 3;

    const limit = fetchLimit ?? (process.env.FETCH_LIMIT ? parseInt(process.env.FETCH_LIMIT, 10) : 20);

    const emails = await fetchEmails(limit);
    if (emails.length === 0) {
      console.log("✅  No unread emails to process.");
      return;
    }

    console.log("\n🔍  Running triage pipeline…\n");
    const triaged = await triageBatch(emails, {
      concurrency,
      aiCallDelayMs: aiDelay,
    });

    printSummary(triaged);
    writeOutput(triaged);
    await postToBackend(triaged);
  } catch (err: any) {
    console.error("\n❌  Error:", err.message ?? err);
    // In daemon mode, we don't want to exit on a single error
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
    // One-shot mode (existing behavior)
    await main();
    return;
  }

  // Daemon mode
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
