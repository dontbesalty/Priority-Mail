/**
 * normalize.ts
 *
 * Converts a raw Gmail message into a clean, flat NormalizedEmail object.
 * Handles plain-text and HTML-only emails. Strips HTML tags, tracking
 * pixels, quoted history, and invisible Unicode characters.
 */

export interface NormalizedEmail {
  id: string;
  threadId: string;
  source: "gmail" | "o365";   // which email provider
  accountEmail: string;       // which account this email belongs to
  subject: string;
  from: string;
  to: string;
  date: string;       // ISO string
  snippet: string;    // short preview from Gmail
  body: string;       // clean plain-text body
  isUnread: boolean;
  labels: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getHeader(
  headers: { name?: string | null; value?: string | null }[],
  name: string
): string {
  const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeBody(data?: string | null): string {
  if (!data) return "";
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Strip HTML tags and decode common HTML entities.
 * Also removes invisible Unicode characters used as email tracking pixels.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "")
    .replace(/&[a-z]{2,6};/g, " ")
    // Invisible Unicode tracking chars (zero-width space, BOM, soft hyphen, etc.)
    .replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff\u00ad]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Recursively search a MIME part tree for a part with the given mimeType.
 * Returns the decoded text of the first matching part, or null.
 */
function findPart(part: any, mimeType: string): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBody(part.body.data);
  }
  if (part.parts && Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const result = findPart(child, mimeType);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Extract clean body text from a Gmail message payload.
 * Priority: text/plain > text/html (stripped).
 */
function extractBodyText(payload: any): string {
  const plain = findPart(payload, "text/plain");
  if (plain && plain.trim().length > 10) return plain;

  const html = findPart(payload, "text/html");
  if (html) return stripHtml(html);

  return "";
}

/**
 * Remove quoted reply history from a plain-text email body.
 * Strips lines that start with '>' and common "On ... wrote:" separators.
 */
function stripQuotedHistory(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];

  for (const line of lines) {
    if (/^On .+wrote:$/i.test(line.trim())) break;
    if (line.trimStart().startsWith(">")) continue;
    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function normalizeMessage(raw: any): NormalizedEmail {
  const headers: { name?: string | null; value?: string | null }[] =
    raw.payload?.headers ?? [];

  const rawDate = getHeader(headers, "Date");
  const date = rawDate
    ? new Date(rawDate).toISOString()
    : new Date().toISOString();

  const rawBody = extractBodyText(raw.payload);
  const body = rawBody ? stripQuotedHistory(rawBody) : raw.snippet ?? "";

  return {
    id: raw.id ?? "",
    threadId: raw.threadId ?? "",
    source: "gmail",
    accountEmail: process.env.GMAIL_ACCOUNT_EMAIL ?? "",
    subject: getHeader(headers, "Subject") || "(no subject)",
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    date,
    snippet: raw.snippet ?? "",
    body,
    isUnread: (raw.labelIds ?? []).includes("UNREAD"),
    labels: raw.labelIds ?? [],
  };
}
