/**
 * index.ts
 *
 * Entry point for the Gmail connector + triage pipeline.
 *
 * Flow:
 *   1. Fetch unread emails from Gmail
 *   2. Run Rules Engine (fast, free pre-classification)
 *   3. Run AI Classifier for emails that need it (OpenRouter)
 *   4. Sort by priority
 *   5. Print summary to console
 *   6. Write output/triaged.json (always)
 *   7. POST to backend API if BACKEND_URL is set (Docker stack mode)
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
      // Log successful run
      await fetch(`${backendUrl}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: "info",
          source: "gmail-connector",
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

async function main(): Promise<void> {
  try {
    const emails = await fetchEmails();
    if (emails.length === 0) {
      console.log("✅  No unread emails to process.");
      return;
    }

    console.log("\n🔍  Running triage pipeline…\n");
    const triaged = await triageBatch(emails);

    printSummary(triaged);
    writeOutput(triaged);
    await postToBackend(triaged);
  } catch (err: any) {
    console.error("\n❌  Error:", err.message ?? err);
    process.exit(1);
  }
}

main();
