/**
 * normalize.ts — O365 connector
 *
 * Converts a raw Microsoft Graph API message into a NormalizedEmail.
 * Reuses the same interface as the Gmail connector so both feed the
 * same triage pipeline and backend schema.
 */

export interface NormalizedEmail {
  id: string;
  threadId: string;
  source: "gmail" | "o365";
  accountEmail: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
  isUnread: boolean;
  labels: string[];  // O365 "categories" mapped here
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "").replace(/&[a-z]{2,6};/g, " ")
    .replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff\u00ad]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function stripQuotedHistory(text: string): string {
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

/**
 * Converts a Graph API message object to NormalizedEmail.
 * Expects fields: id, subject, from, toRecipients, receivedDateTime,
 *   bodyPreview, body { contentType, content }, categories, isRead,
 *   conversationId
 */
export function normalizeMessage(msg: any): NormalizedEmail {
  const accountEmail = process.env.OUTLOOK_ACCOUNT_EMAIL ?? "";

  const fromName = msg.from?.emailAddress?.name ?? "";
  const fromAddr = msg.from?.emailAddress?.address ?? "";
  const from = fromName ? `${fromName} <${fromAddr}>` : fromAddr;

  const firstTo = msg.toRecipients?.[0];
  const toName = firstTo?.emailAddress?.name ?? "";
  const toAddr = firstTo?.emailAddress?.address ?? "";
  const to = toName ? `${toName} <${toAddr}>` : toAddr;

  let body = "";
  if (msg.body?.contentType?.toLowerCase() === "html") {
    body = stripHtml(msg.body.content ?? "");
  } else {
    body = msg.body?.content ?? "";
  }
  body = stripQuotedHistory(body);

  return {
    id: msg.id ?? "",
    threadId: msg.conversationId ?? msg.id ?? "",
    source: "o365",
    accountEmail,
    subject: msg.subject ?? "(no subject)",
    from,
    to,
    date: msg.receivedDateTime ?? new Date().toISOString(),
    snippet: msg.bodyPreview ?? "",
    body,
    isUnread: !msg.isRead,
    labels: msg.categories ?? [],
  };
}
