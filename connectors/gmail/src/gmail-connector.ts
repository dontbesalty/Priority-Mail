/**
 * gmail-connector.ts
 *
 * Authenticates with Gmail via OAuth2 and fetches messages.
 * Returns an array of NormalizedEmail objects.
 */

import { google } from "googleapis";
import * as dotenv from "dotenv";
import { normalizeMessage, NormalizedEmail } from "./normalize";

dotenv.config();

const {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
  FETCH_LIMIT,
} = process.env;

function buildOAuthClient() {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
    throw new Error(
      "Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env"
    );
  }
  if (!GMAIL_REFRESH_TOKEN) {
    throw new Error(
      "Missing GMAIL_REFRESH_TOKEN in .env — run `npm run auth` first"
    );
  }

  // The redirect URI is only used during the initial auth flow.
  // Once we have a refresh token it is not needed, but the OAuth2
  // constructor still requires a value — localhost is the correct choice.
  const oauth2Client = new google.auth.OAuth2(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    "http://localhost"
  );

  oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return oauth2Client;
}

export interface FetchOptions {
  /** Gmail search query — defaults to unread inbox messages */
  query?: string;
  /** Max number of messages to fetch — defaults to FETCH_LIMIT env var or 20 */
  maxResults?: number;
}

/**
 * Fetch emails from Gmail and return normalized objects.
 */
export async function fetchEmails(
  options: FetchOptions = {}
): Promise<NormalizedEmail[]> {
  const auth = buildOAuthClient();
  const gmail = google.gmail({ version: "v1", auth });

  // Compute timestamp for 24 hours ago (Unix seconds)
  const afterTimestamp = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const defaultQuery = `in:inbox is:unread after:${afterTimestamp}`;
  const query = options.query ?? defaultQuery;
  const maxResults = options.maxResults ?? parseInt(FETCH_LIMIT ?? "20", 10);

  console.log(`\n📬  Fetching up to ${maxResults} emails (query: "${query}")…`);

  // 1. List matching message IDs
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = listRes.data.messages ?? [];
  if (messages.length === 0) {
    console.log("✅  No messages matched the query.");
    return [];
  }

  console.log(`   Found ${messages.length} message(s). Fetching full content…`);

  // 2. Fetch each message in full (parallel, batched in groups of 10)
  const BATCH_SIZE = 10;
  const normalized: NormalizedEmail[] = [];

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(
      batch.map((msg) =>
        gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full",
        })
      )
    );
    for (const res of fetched) {
      normalized.push(normalizeMessage(res.data));
    }
  }

  return normalized;
}
