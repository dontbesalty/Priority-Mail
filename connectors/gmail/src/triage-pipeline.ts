/**
 * triage-pipeline.ts
 *
 * Wires together: NormalizedEmail → Rules Engine → (AI Classifier) → TriagedEmail
 *
 * Rules are applied first. If the rule is confident and sets skip_ai=true,
 * we skip the OpenRouter call entirely (saves money + time).
 * AI results and rule results are merged, with rules taking precedence
 * where confidence = 1.0.
 */

import { NormalizedEmail } from "./normalize";
import { applyRules, RulesResult } from "./rules-engine";
import { classifyWithAI, classifyWithLocalAI, AIClassification } from "./ai-classifier";

export interface TriagedEmail {
  // Original email fields
  id: string;
  threadId: string;
  source: string;       // "gmail" | "o365"
  accountEmail: string; // which mailbox this email came from
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
  isUnread: boolean;
  labels: string[];
  // Classification
  classification: AIClassification;
  rule_fired?: string;
  classified_by: "rules" | "ai" | "rules+ai";
}

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/**
 * Simple sleep helper
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function triageEmail(email: NormalizedEmail): Promise<TriagedEmail> {
  const rules = applyRules(email);

  // ── skip_ai: classified entirely by rules, no AI call ─────────────────────
  if (rules.skip_ai && rules.priority && rules.category) {
    return toTriagedEmail(email, {
      priority: rules.priority,
      category: rules.category,
      priority_reason: `Classified by rule: ${rules.rule_fired}`,
      reply_needed: false,
      task_needed: false,
      confidence: rules.confidence,
    }, rules, "rules");
  }

  // ── local_ai_only: confidential — try local AI, fall back to rules ─────────
  if (rules.local_ai_only) {
    try {
      const localResult = await classifyWithLocalAI(email);
      const merged = mergeResults(rules, localResult);
      const classified_by = rules.confidence > 0 ? "rules+ai" : "ai";
      return toTriagedEmail(email, merged, rules, classified_by);
    } catch (err: any) {
      // LOCAL_AI_URL not configured or call failed — classify by rules only
      console.warn(
        `⚠️  [local-ai] ${email.subject.slice(0, 50)} — ${err.message}. Falling back to rules-only.`
      );
      return toTriagedEmail(email, {
        priority: rules.priority ?? "High",
        category: rules.category ?? "Client Request",
        priority_reason: `Confidential — classified by rule (local AI unavailable): ${rules.rule_fired}`,
        reply_needed: false,
        task_needed: false,
        confidence: rules.confidence,
      }, rules, "rules");
    }
  }

  // ── standard path: call cloud AI (OpenRouter) ─────────────────────────────
  const aiResult = await classifyWithAI(email);
  const merged = mergeResults(rules, aiResult);
  const classified_by = rules.confidence > 0 ? "rules+ai" : "ai";
  return toTriagedEmail(email, merged, rules, classified_by);
}

function mergeResults(
  rules: RulesResult,
  ai: AIClassification
): AIClassification {
  if (rules.confidence < 1.0) return ai;

  return {
    ...ai,
    priority: rules.priority ?? ai.priority,
    category: (rules.category as AIClassification["category"]) ?? ai.category,
    confidence: Math.max(rules.confidence, ai.confidence),
  };
}

function toTriagedEmail(
  email: NormalizedEmail,
  classification: AIClassification,
  rules: RulesResult,
  classified_by: TriagedEmail["classified_by"]
): TriagedEmail {
  return {
    id: email.id,
    threadId: email.threadId,
    source: email.source,
    accountEmail: email.accountEmail,
    subject: email.subject,
    from: email.from,
    to: email.to,
    date: email.date,
    snippet: email.snippet,
    body: email.body,
    isUnread: email.isUnread,
    labels: email.labels,
    classification,
    rule_fired: rules.rule_fired,
    classified_by,
  };
}

/**
 * Run the triage pipeline on a batch of emails.
 * AI calls are made concurrently for emails that need it,
 * but we cap concurrency to avoid rate limits.
 */
export async function triageBatch(
  emails: NormalizedEmail[],
  {
    concurrency = 1,
    aiCallDelayMs = 3000,
  }: { concurrency?: number; aiCallDelayMs?: number } = {}
): Promise<TriagedEmail[]> {
  const results: TriagedEmail[] = [];
  let idx = 0;

  async function worker() {
    while (idx < emails.length) {
      const email = emails[idx++];
      try {
        const triaged = await triageEmail(email);
        results.push(triaged);
        const p = triaged.classification.priority;
        const indicator = p === "High" ? "🔴" : p === "Medium" ? "🟡" : "⚪";
        const logMsg = `${indicator} [${triaged.classified_by}] ${email.subject.slice(0, 60)}`;
        console.log(logMsg);

        // Send to backend logs
        const backendUrl = process.env.BACKEND_URL;
        if (backendUrl) {
          fetch(`${backendUrl}/logs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              level: "info",
              source: "gmail-connector",
              message: logMsg,
              metadata: {
                email_id: triaged.id,
                priority: p,
                classified_by: triaged.classified_by,
                rule_fired: triaged.rule_fired,
              },
            }),
          }).catch(() => {}); // Silent fail for logs
        }

        // Add delay between calls to respect rate limits if needed
        if (aiCallDelayMs > 0 && idx < emails.length) {
          await sleep(aiCallDelayMs);
        }
      } catch (err: any) {
        const errorMsg = `❌ Failed to triage "${email.subject}": ${err.message}`;
        console.error(errorMsg);

        // Send to backend logs
        const backendUrl = process.env.BACKEND_URL;
        if (backendUrl) {
          fetch(`${backendUrl}/logs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              level: "error",
              source: "gmail-connector",
              message: errorMsg,
              metadata: { 
                subject: email.subject,
                error: err.message 
              },
            }),
          }).catch(() => {});
        }

        // Push a fallback result so we don't lose the email
        results.push({
          ...email,
          classification: {
            priority: "Medium",
            category: "Other",
            priority_reason: "Triage error",
            reply_needed: false,
            task_needed: false,
            confidence: 0,
          },
          classified_by: "rules",
        });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  // Sort: High → Medium → Low, then by date desc within each priority
  return results.sort((a, b) => {
    const pd =
      PRIORITY_ORDER[a.classification.priority] -
      PRIORITY_ORDER[b.classification.priority];
    if (pd !== 0) return pd;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
}
