"use client";

import Link from "next/link";
import { useState } from "react";
import { Email, actionEmail } from "@/lib/api";

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

export default function EmailList({ initialEmails, activeSource }: { initialEmails: Email[], activeSource: string }) {
  const [emails, setEmails] = useState(initialEmails);

  async function handleAction(e: React.MouseEvent, emailId: string, action: "approved" | "dismissed") {
    e.preventDefault();
    e.stopPropagation();

    // Optimistically remove from UI
    setEmails(prev => prev.filter(email => email.id !== emailId));

    try {
      await actionEmail(emailId, action);
    } catch (err) {
      console.error(`Failed to ${action} email:`, err);
    }
  }

  if (emails.length === 0) {
    return (
      <div className="py-12 text-center text-gray-400">
        <p className="text-3xl mb-2">📭</p>
        <p className="font-medium">No {activeSource === "gmail" ? "Gmail" : "Outlook"} emails yet</p>
        <p className="text-sm mt-1">
          Run the {activeSource === "gmail" ? "Gmail" : "O365"} connector to fetch emails.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 shadow-sm">
      {emails.map((email) => (
        <Link
          key={email.id}
          href={`/email/${encodeURIComponent(email.id)}`}
          className="block hover:bg-gray-50 transition-colors group relative"
        >
          <div className="px-4 py-3 flex items-start gap-3">
            {/* Priority dot */}
            <span className="mt-0.5 text-base shrink-0">
              {PRIORITY_DOTS[email.priority] ?? "⚪"}
            </span>

            <div className="flex-1 min-w-0 pr-10">
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

            {/* Quick actions: Approve / Dismiss */}
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 backdrop-blur pl-2 rounded-l-lg">
              <button
                onClick={(e) => handleAction(e, email.id, "approved")}
                title="Approve"
                className="p-1.5 rounded-md bg-green-50 text-green-600 hover:bg-green-100 border border-green-100 transition-colors"
              >
                <span className="text-sm">✅</span>
              </button>
              <button
                onClick={(e) => handleAction(e, email.id, "dismissed")}
                title="Dismiss"
                className="p-1.5 rounded-md bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-100 transition-colors"
              >
                <span className="text-sm">❌</span>
              </button>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
