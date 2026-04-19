import Link from "next/link";
import { getEmails, Email } from "@/lib/api";

const PRIORITY_STYLES: Record<string, string> = {
  High: "bg-red-100 text-red-700 border border-red-200",
  Medium: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  Low: "bg-gray-100 text-gray-500 border border-gray-200",
};

const PRIORITY_DOTS: Record<string, string> = {
  High: "🔴",
  Medium: "🟡",
  Low: "⚪",
};

function fromName(from: string): string {
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : from.replace(/<[^>]+>/, "").trim();
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 1000 / 3600;
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SourceBadge({ source }: { source?: string }) {
  if (!source || source === "unknown") return null;
  if (source === "gmail") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-blue-100 text-blue-700 border border-blue-200 shrink-0">
        Gmail
      </span>
    );
  }
  if (source === "o365") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-cyan-100 text-cyan-700 border border-cyan-200 shrink-0">
        Outlook
      </span>
    );
  }
  return (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-500 border border-gray-200 shrink-0">
      {source}
    </span>
  );
}

type Props = {
  searchParams: { source?: string };
};

export default async function InboxPage({ searchParams }: Props) {
  const activeSource = searchParams.source ?? "";
  let emails: Email[] = [];
  let error: string | null = null;

  try {
    emails = await getEmails({
      actioned: false,
      source: activeSource || undefined,
    });
  } catch (e: any) {
    error = e.message;
  }

  const high = emails.filter((e) => e.priority === "High");
  const medium = emails.filter((e) => e.priority === "Medium");
  const low = emails.filter((e) => e.priority === "Low");

  // Determine which sources exist so we can show/hide filter tabs dynamically
  const sourcesInInbox = new Set(emails.map((e) => e.source));

  if (error) {
    return (
      <div className="mt-8 p-4 bg-red-50 border border-red-200 rounded text-red-700">
        <p className="font-medium">Could not load emails</p>
        <p className="text-sm mt-1">{error}</p>
        <p className="text-sm mt-2 text-gray-500">
          Make sure the backend is running and the connector has ingested emails.
        </p>
      </div>
    );
  }

  if (emails.length === 0 && !activeSource) {
    return (
      <div className="mt-16 text-center text-gray-400">
        <p className="text-4xl mb-3">📭</p>
        <p className="font-medium">No emails yet</p>
        <p className="text-sm mt-1">
          Run a connector to fetch and triage your inbox.
        </p>
        <div className="mt-3 flex flex-col gap-1 items-center">
          <code className="text-xs bg-gray-100 rounded px-3 py-2 inline-block">
            docker compose run --rm gmail-connector
          </code>
          <code className="text-xs bg-gray-100 rounded px-3 py-2 inline-block">
            docker compose run --rm o365-connector
          </code>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Source filter tabs */}
      <div className="flex gap-2 mb-4">
        <FilterTab href="/" label="All" active={!activeSource} />
        <FilterTab href="/?source=gmail" label="Gmail" active={activeSource === "gmail"} />
        <FilterTab href="/?source=o365" label="Outlook" active={activeSource === "o365"} />
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-6">
        <Stat label="High" count={high.length} color="text-red-600" />
        <Stat label="Medium" count={medium.length} color="text-yellow-600" />
        <Stat label="Low" count={low.length} color="text-gray-400" />
        <Stat label="Total" count={emails.length} color="text-gray-700" />
      </div>

      {emails.length === 0 ? (
        <div className="py-12 text-center text-gray-400">
          <p className="text-3xl mb-2">📭</p>
          <p className="font-medium">No {activeSource === "gmail" ? "Gmail" : "Outlook"} emails yet</p>
          <p className="text-sm mt-1">
            Run the {activeSource === "gmail" ? "Gmail" : "O365"} connector to fetch emails.
          </p>
        </div>
      ) : (
        /* Email list */
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 shadow-sm">
          {emails.map((email) => (
            <Link
              key={email.id}
              href={`/email/${encodeURIComponent(email.id)}`}
              className="block hover:bg-gray-50 transition-colors"
            >
              <div className="px-4 py-3 flex items-start gap-3">
                {/* Priority dot */}
                <span className="mt-0.5 text-base shrink-0">
                  {PRIORITY_DOTS[email.priority] ?? "⚪"}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {email.subject}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {relativeDate(email.received_at ?? email.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500 truncate">
                      {fromName(email.from_address)}
                    </span>
                    {/* Source badge — only show when viewing "All" */}
                    {!activeSource && <SourceBadge source={email.source} />}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${PRIORITY_STYLES[email.priority]}`}
                    >
                      {email.category}
                    </span>
                  </div>
                  {email.priority_reason && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {email.priority_reason}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`text-sm px-3 py-1 rounded-full border transition-colors ${
        active
          ? "bg-gray-800 text-white border-gray-800"
          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
      }`}
    >
      {label}
    </Link>
  );
}

function Stat({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-2 text-center shadow-sm">
      <p className={`text-xl font-bold ${color}`}>{count}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
