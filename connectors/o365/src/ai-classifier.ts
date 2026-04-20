/**
 * ai-classifier.ts
 *
 * Calls OpenRouter to classify a NormalizedEmail and return a structured
 * AIClassification. Only called when the Rules Engine doesn't skip_ai.
 *
 * Uses native fetch (Node 18+). No extra HTTP library needed.
 */

import { NormalizedEmail } from "./normalize";
import { Priority, Category } from "./rules-engine";

export interface AIClassification {
  priority: Priority;
  category: Category;
  priority_reason: string; // 1 sentence
  reply_needed: boolean;
  task_needed: boolean;
  task_title?: string;
  due_date_guess?: string; // ISO date string or null
  reply_draft?: string;
  confidence: number; // 0.0 – 1.0
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You are an email triage assistant. Classify the email and respond ONLY with valid JSON matching this exact schema:

{
  "priority": "High" | "Medium" | "Low",
  "category": one of ["Client Request","Internal Team","Billing / Invoice","Sales Lead","Support Issue","Waiting On Someone Else","Newsletter / Marketing","Spam / Low Importance","Security Alert","Real Estate","Financial Update","Other"],
  "priority_reason": "one sentence",
  "reply_needed": boolean,
  "task_needed": boolean,
  "task_title": "string or null",
  "due_date_guess": "ISO date string or null",
  "reply_draft": "short reply if reply_needed, else null",
  "confidence": number between 0 and 1
}

Rules:
- High priority = needs action today, has a deadline, or comes from a real person expecting a response
- Medium priority = informational but worth noting, no urgent action
- Low priority = newsletters, promotions, automated alerts, no action needed
- confidence = your certainty in the classification (0.0–1.0)`;

function buildPrompt(email: NormalizedEmail): string {
  const bodyPreview = email.body.slice(0, 800).replace(/\n+/g, " ").trim();
  return [
    `Subject: ${email.subject}`,
    `From: ${email.from}`,
    `Date: ${email.date}`,
    `Gmail Labels: ${email.labels.join(", ")}`,
    ``,
    `Body:`,
    bodyPreview || email.snippet,
  ].join("\n");
}

function parseJSON(text: string): any {
  // Extract JSON from the response (model may wrap it in markdown code fences)
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  const raw = fenced ? fenced[1] : text;
  return JSON.parse(raw.trim());
}

function validateClassification(obj: any): AIClassification {
  const validPriorities: Priority[] = ["High", "Medium", "Low"];
  const validCategories: Category[] = [
    "Client Request",
    "Internal Team",
    "Billing / Invoice",
    "Sales Lead",
    "Support Issue",
    "Waiting On Someone Else",
    "Newsletter / Marketing",
    "Spam / Low Importance",
    "Security Alert",
    "Real Estate",
    "Financial Update",
    "Other",
  ];

  if (!validPriorities.includes(obj.priority)) obj.priority = "Medium";
  if (!validCategories.includes(obj.category)) obj.category = "Other";
  if (typeof obj.confidence !== "number") obj.confidence = 0.5;
  obj.confidence = Math.min(1, Math.max(0, obj.confidence));
  obj.reply_needed = Boolean(obj.reply_needed);
  obj.task_needed = Boolean(obj.task_needed);

  return obj as AIClassification;
}

/**
 * classifyWithLocalAI
 *
 * Calls a LOCAL OpenAI-compatible endpoint (e.g. Ollama).
 * Env vars:
 *   LOCAL_AI_URL   — base URL, e.g. http://localhost:11434/v1
 *   LOCAL_AI_MODEL — model name, e.g. llama3.2 or mistral
 *
 * Throws if LOCAL_AI_URL is not set so the caller can fall back gracefully.
 */
export async function classifyWithLocalAI(
  email: NormalizedEmail
): Promise<AIClassification> {
  const baseUrl = process.env.LOCAL_AI_URL;
  const model = process.env.LOCAL_AI_MODEL || "llama3.2";

  if (!baseUrl) {
    throw new Error("LOCAL_AI_URL is not configured — cannot use local AI");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const prompt = buildPrompt(email);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Local AI error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as any;
  const content: string = data.choices?.[0]?.message?.content ?? "";

  try {
    return validateClassification(parseJSON(content));
  } catch {
    return {
      priority: "Medium",
      category: "Other",
      priority_reason: "Local AI classification failed — review manually",
      reply_needed: false,
      task_needed: false,
      confidence: 0,
    };
  }
}

/**
 * Helper to call OpenRouter with retry logic for 429 rate limits
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s...
        const backoff = Math.pow(2, attempt) * 1000;
        console.log(
          `Rate limited. Retrying in ${backoff}ms (attempt ${attempt}/${maxRetries})...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      const res = await fetch(url, options);

      if (res.status === 429) {
        lastError = new Error(`Rate limit exceeded (429)`);
        continue;
      }

      return res;
    } catch (err: any) {
      lastError = err;
      if (attempt === maxRetries) throw err;
    }
  }
  throw lastError || new Error("Failed after retries");
}

export async function classifyWithAI(
  email: NormalizedEmail
): Promise<AIClassification> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model =
    process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set in .env");
  }

  const prompt = buildPrompt(email);

  const res = await fetchWithRetry(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/prioritymail",
      "X-Title": "Priority Mail",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.1, // low temp for consistent JSON output
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as any;
  const content: string = data.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = parseJSON(content);
    return validateClassification(parsed);
  } catch {
    // Retry once — ask the model to fix its output
    try {
      const retry = await fetchWithRetry(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
            { role: "assistant", content },
            {
              role: "user",
              content:
                "Your response was not valid JSON. Reply with ONLY the JSON object, no markdown.",
            },
          ],
          temperature: 0,
        }),
      });
      const retryData = (await retry.json()) as any;
      const retryContent: string =
        retryData.choices?.[0]?.message?.content ?? "{}";
      return validateClassification(parseJSON(retryContent));
    } catch {
      // Fallback if still broken
      return {
        priority: "Medium",
        category: "Other",
        priority_reason: "AI classification failed",
        reply_needed: false,
        task_needed: false,
        confidence: 0,
      };
    }
  }
}
