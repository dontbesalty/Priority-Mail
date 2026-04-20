interface PushoverConfig {
  appToken: string;
  userKey: string;
  frontendUrl?: string;
  notifyPriority?: string;
}

export async function sendPushoverNotification(
  emails: { id: string; subject: string; from_address: string; category: string; priority_reason: string }[],
  config: PushoverConfig
): Promise<void> {
  let title: string;
  let message: string;

  if (emails.length === 1) {
    const e = emails[0];
    title = "🔴 High Priority Email";
    message = [
      `From: ${e.from_address}`,
      `Re: ${e.subject}`,
      `Category: ${e.category}`,
      e.priority_reason ? `Why: ${e.priority_reason}` : null,
    ].filter(Boolean).join("\n");
  } else {
    title = `🔴 ${emails.length} High Priority Emails`;
    message = emails
      .map(e => `• ${e.subject} — ${e.from_address}`)
      .join("\n");
  }

  const body: Record<string, string | number> = {
    token:    config.appToken,
    user:     config.userKey,
    title,
    message,
    priority: 1,
    sound:    "persistent",
  };

  if (config.frontendUrl) {
    // For batches, link to the inbox; for a single email, deep-link to that email
    body.url = emails.length === 1
      ? `${config.frontendUrl}/email/${encodeURIComponent(emails[0].id)}`
      : config.frontendUrl;
    body.url_title = emails.length === 1 ? "Open Email" : "Open Priority Mail";
  }

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pushover API error ${res.status}: ${text}`);
  }
}
