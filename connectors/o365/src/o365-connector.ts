/**
 * o365-connector.ts
 *
 * Fetches unread emails from Microsoft Graph API using a stored refresh token.
 * Exchanges the refresh token for an access token on each run (no token cache).
 * Returns an array of NormalizedEmail objects ready for the triage pipeline.
 */

import { normalizeMessage, NormalizedEmail } from "./normalize";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

// ── Token refresh ─────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const refreshToken = process.env.OUTLOOK_REFRESH_TOKEN;
  const tenantId = process.env.OUTLOOK_TENANT_ID ?? "consumers";

  if (!clientId) throw new Error("OUTLOOK_CLIENT_ID is not set in .env");
  if (!refreshToken) {
    throw new Error(
      "OUTLOOK_REFRESH_TOKEN is not set. Run: npm run auth"
    );
  }

  const res = await fetch(TOKEN_URL(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://graph.microsoft.com/Mail.Read offline_access",
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as any;
  return data.access_token as string;
}

// ── Email fetch ───────────────────────────────────────────────────────────────

export async function fetchEmails(): Promise<NormalizedEmail[]> {
  const limit = parseInt(process.env.FETCH_LIMIT ?? "20");
  const accountEmail = process.env.OUTLOOK_ACCOUNT_EMAIL ?? "";

  console.log(
    `\n📬  Fetching up to ${limit} unread Outlook emails (${accountEmail || "account not set"})…`
  );

  const accessToken = await getAccessToken();

  const params = new URLSearchParams({
    $filter: "isRead eq false",
    $top: String(limit),
    $select: [
      "id", "subject", "from", "toRecipients",
      "receivedDateTime", "bodyPreview", "body",
      "categories", "isRead", "conversationId",
    ].join(","),
    $orderby: "receivedDateTime desc",
  });

  const res = await fetch(`${GRAPH_BASE}/me/mailFolders/inbox/messages?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error (${res.status}): ${err}`);
  }

  const data = (await res.json()) as any;
  const messages: any[] = data.value ?? [];

  console.log(`   Found ${messages.length} unread message(s). Normalizing…`);

  return messages.map(normalizeMessage);
}
