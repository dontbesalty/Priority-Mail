/**
 * auth.ts
 *
 * One-time OAuth2 flow to generate a refresh token.
 * Run with: npm run auth
 *
 * How it works:
 *  1. Starts a temporary local HTTP server on PORT (default 3000)
 *  2. Opens the Google auth URL in your default browser
 *  3. Google redirects back to http://localhost:PORT with a ?code=...
 *  4. The server captures the code, exchanges it for tokens
 *  5. Prints GMAIL_REFRESH_TOKEN — add it to your .env
 *  6. Server shuts down automatically
 *
 * Prerequisites in Google Cloud Console:
 *  - OAuth client type: Desktop app  (NOT Web application)
 *  - Add the intended Gmail as a Test User on the OAuth consent screen
 *  - No need to add a redirect URI — Desktop app clients accept http://localhost on any port
 */

import * as http from "http";
import { google } from "googleapis";
import * as dotenv from "dotenv";

dotenv.config();

const {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_ACCOUNT_EMAIL,
} = process.env;

// Port the temporary server will listen on
const PORT = parseInt(process.env.AUTH_PORT ?? "3000", 10);
const REDIRECT_URI = `http://localhost:${PORT}`;

if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) {
  console.error(
    "❌  Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env\n" +
    "   Get these from Google Cloud Console → APIs & Services → Credentials\n" +
    "   Make sure the OAuth client type is: Desktop app"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  REDIRECT_URI
);

// gmail.readonly covers everything we need:
// - list messages, read full bodies, read metadata, search with 'q'
// Do NOT add gmail.metadata here — it is a restricted subset that
// disables the 'q' search parameter and blocks full message access.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
];

const authUrlOptions: Parameters<typeof oauth2Client.generateAuthUrl>[0] = {
  access_type: "offline",
  scope: SCOPES,
  // "consent" ensures a refresh_token is always returned
  prompt: "consent",
};

if (GMAIL_ACCOUNT_EMAIL) {
  authUrlOptions.login_hint = GMAIL_ACCOUNT_EMAIL;
}

const authUrl = oauth2Client.generateAuthUrl(authUrlOptions);

console.log("\n════════════════════════════════════════════════════");
console.log("  Gmail OAuth2 — One-time Auth");
console.log("════════════════════════════════════════════════════\n");

if (GMAIL_ACCOUNT_EMAIL) {
  console.log(`✅  Target account : ${GMAIL_ACCOUNT_EMAIL}`);
} else {
  console.warn("⚠️   GMAIL_ACCOUNT_EMAIL is not set — Google may pick any signed-in account.");
  console.warn("    Add it to .env: GMAIL_ACCOUNT_EMAIL=you@gmail.com\n");
}

console.log(`🌐  Callback server: ${REDIRECT_URI}`);
console.log(`\n📋  Open this URL in your browser`);
console.log(`    (Incognito window recommended — ⌘+Shift+N in Chrome):\n`);
console.log(`    ${authUrl}\n`);

// ── Temporary local HTTP server to catch the OAuth callback ──────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    const msg = `❌  Google returned an error: ${error}`;
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h2>${msg}</h2><p>Check the terminal for details.</p>`);
    console.error(msg);
    server.close();
    process.exit(1);
  }

  if (!code) {
    // Ignore favicon requests etc.
    res.writeHead(404);
    res.end();
    return;
  }

  // Show a success page immediately so the user can close the tab
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <html><body style="font-family:sans-serif;padding:2rem">
      <h2>✅ Authorisation successful!</h2>
      <p>You can close this tab and return to the terminal.</p>
    </body></html>
  `);

  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log("✅  Authorisation successful!\n");
    console.log("Add this line to your .env file:");
    console.log("────────────────────────────────────────────────────");
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("────────────────────────────────────────────────────\n");
  } catch (err: any) {
    console.error("❌  Failed to exchange code for tokens:", err.message ?? err);
    server.close();
    process.exit(1);
  }

  server.close(() => {
    console.log("🔒  Auth server closed. Setup complete!\n");
    process.exit(0);
  });
});

server.listen(PORT, () => {
  console.log(`⏳  Waiting for Google to redirect to ${REDIRECT_URI}…\n`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `❌  Port ${PORT} is already in use.\n` +
      `   Set a different port: AUTH_PORT=3001 npm run auth`
    );
  } else {
    console.error("❌  Server error:", err.message);
  }
  process.exit(1);
});
