import Link from "next/link";
import { getEmails, Email, getLastRuns } from "@/lib/api";
import EmailList from "./EmailList";

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 1000 / 3600;
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Props = {
  searchParams: { source?: string };
};

export default async function InboxPage({ searchParams }: Props) {
  const activeSource = searchParams.source ?? "";
  let emails: Email[] = [];
  let lastRuns: Record<string, string> = {};
  let error: string | null = null;

  try {
    [emails, lastRuns] = await Promise.all([
      getEmails({
        actioned: false,
        source: activeSource || undefined,
      }),
      getLastRuns().catch(() => ({})),
    ]);
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
        <div className="flex-grow"></div>
        <Link
          href="/tasks"
          className="text-sm px-3 py-1 rounded-full border bg-white text-gray-600 border-gray-200 hover:border-gray-400 flex items-center gap-1"
        >
          📋 Tasks
        </Link>
        <Link
          href="/logs"
          className="text-sm px-3 py-1 rounded-full border bg-white text-gray-600 border-gray-200 hover:border-gray-400 flex items-center gap-1"
        >
          📜 Logs
        </Link>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <Stat label="High" count={high.length} color="text-red-600" />
        <Stat label="Medium" count={medium.length} color="text-yellow-600" />
        <Stat label="Low" count={low.length} color="text-gray-400" />
        <Stat label="Total" count={emails.length} color="text-gray-700" />

        <div className="flex flex-col gap-0.5 ml-2">
          {(activeSource === "gmail" || !activeSource) && lastRuns["gmail-connector"] && (
            <div className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span>
              Gmail last run: {relativeDate(lastRuns["gmail-connector"])}
            </div>
          )}
          {(activeSource === "o365" || !activeSource) && lastRuns["o365-connector"] && (
            <div className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              Outlook last run: {relativeDate(lastRuns["o365-connector"])}
            </div>
          )}
        </div>
      </div>

      <EmailList initialEmails={emails} activeSource={activeSource} />
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
