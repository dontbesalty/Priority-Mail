/**
 * auth.ts — O365 connector
 *
 * One-time OAuth2 Authorization Code + PKCE flow for Microsoft accounts.
 * Run with:  npm run auth
 *
 * This script:
 *  1. Generates a PKCE code verifier/challenge
 *  2. Opens the Microsoft login URL in your browser
 *  3. Starts a local callback HTTP server on AUTH_PORT (default 3001)
 *  4. Exchanges the authorization code for tokens
 *  5. Prints the refresh_token — paste it into .env as OUTLOOK_REFRESH_TOKEN
 */

import * as crypto from "crypto";
import * as http from "http";
import * as dotenv from "dotenv";

dotenv.config();

const CLIENT_ID = process.env.OUTLOOK_CLIENT_ID;
const TENANT_ID = process.env.OUTLOOK_TENANT_ID ?? "consumers";
const AUTH_PORT = parseInt(process.env.AUTH_PORT ?? "3001");
const REDIRECT_URI = `http://localhost:${AUTH_PORT}/callback`;
const SCOPE = "https://graph.microsoft.com/Mail.Read offline_access User.Read";

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(64));
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

// ── Main auth flow ────────────────────────────────────────────────────────────

async function main() {
  if (!CLIENT_ID) {
    console.error("❌  OUTLOOK_CLIENT_ID is not set in .env");
    process.exit(1);
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = base64url(crypto.randomBytes(16));

  const authUrl =
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  console.log("\n🔐  Priority Mail — Outlook Auth\n");
  console.log("Open this URL in your browser to authorize:\n");
  console.log(authUrl);
  console.log("\nWaiting for redirect to localhost…\n");

  // Start local callback server
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${AUTH_PORT}`);
      const receivedCode = url.searchParams.get("code");
      const receivedState = url.searchParams.get("state");

      if (url.pathname !== "/callback" || !receivedCode) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      if (receivedState !== state) {
        res.writeHead(400);
        res.end("State mismatch — possible CSRF. Start auth again.");
        reject(new Error("State mismatch"));
        server.close();
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body><h2>✅ Authorization successful!</h2>" +
        "<p>You can close this tab and return to the terminal.</p></body></html>"
      );
      server.close();
      resolve(receivedCode);
    });

    server.listen(AUTH_PORT, () => {
      console.log(`   Listening on http://localhost:${AUTH_PORT}/callback`);
    });

    server.on("error", reject);
  });

  // Exchange authorization code for tokens
  console.log("\n🔄  Exchanging code for tokens…");

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
        scope: SCOPE,
      }).toString(),
    }
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("❌  Token exchange failed:", err);
    process.exit(1);
  }

  const tokens = (await tokenRes.json()) as any;

  console.log("\n✅  Authorization successful!\n");
  console.log("Add this to your connectors/o365/.env file:\n");
  console.log(`OUTLOOK_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log("\nDone. You can now run:  docker compose run --rm o365-connector\n");
}

main().catch((err) => {
  console.error("❌  Auth error:", err.message);
  process.exit(1);
});
