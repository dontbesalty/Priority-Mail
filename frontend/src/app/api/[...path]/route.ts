/**
 * API proxy route handler
 *
 * Catches all /api/* requests from the browser and forwards them to the
 * backend service. Because this runs on the Next.js server, it can read
 * process.env.BACKEND_URL at *runtime* — unlike next.config.mjs rewrites,
 * which are evaluated at build time.
 *
 * Browser:  GET /api/emails          → Next.js server  → http://backend:4000/emails
 * Browser:  GET /api/emails/:id      → Next.js server  → http://backend:4000/emails/:id
 * Browser:  POST /api/emails/ingest  → Next.js server  → http://backend:4000/emails/ingest
 */

import { NextRequest, NextResponse } from "next/server";

type Params = { path: string[] };

function buildBackendUrl(path: string[], search: string): string {
  const base = process.env.BACKEND_URL ?? "http://localhost:4000";
  const joined = path.join("/");
  return `${base}/${joined}${search}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Params }
) {
  const url = buildBackendUrl(params.path, req.nextUrl.search);
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Params }
) {
  const url = buildBackendUrl(params.path, "");
  const body = await req.text();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
