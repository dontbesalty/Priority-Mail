// Server components (Next.js SSR inside Docker) need an absolute URL.
// Client components running in the browser use /api, which next.config.mjs
// rewrites to the backend service automatically.
function getBase(): string {
  if (typeof window === "undefined") {
    // Running on the Next.js server (inside Docker or local dev)
    return process.env.BACKEND_URL ?? "http://localhost:4000";
  }
  // Running in the browser — Next.js rewrite proxies /api/* → backend
  return "/api";
}

export interface Email {
  id: string;
  thread_id: string;
  subject: string;
  from_address: string;
  to_address: string;
  received_at: string;
  snippet: string;
  body?: string;
  labels: string[];
  is_unread: boolean;
  priority: "High" | "Medium" | "Low";
  category: string;
  priority_reason: string;
  reply_needed: boolean;
  task_needed: boolean;
  task_title?: string;
  due_date_guess?: string;
  reply_draft?: string;
  confidence: number;
  source: string;          // "gmail" | "o365"
  account_email: string;   // which mailbox this came from
  rule_fired?: string;
  classified_by: string;
  user_action?: "approved" | "dismissed" | "corrected";
  user_category?: string;
  actioned_at?: string;
  created_at: string;
}

export async function getEmails(params?: {
  priority?: string;
  actioned?: boolean;
  source?: string;
}): Promise<Email[]> {
  const qs = new URLSearchParams();
  if (params?.priority) qs.set("priority", params.priority);
  if (params?.actioned === false) qs.set("actioned", "false");
  if (params?.source) qs.set("source", params.source);
  const res = await fetch(`${getBase()}/emails?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /emails failed: ${res.status}`);
  return res.json();
}

export async function getEmail(id: string): Promise<Email> {
  const res = await fetch(`${getBase()}/emails/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /emails/${id} failed: ${res.status}`);
  return res.json();
}

export async function actionEmail(
  id: string,
  action: "approved" | "dismissed" | "corrected",
  category?: string
): Promise<void> {
  await fetch(`${getBase()}/emails/${id}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, category }),
  });
}
