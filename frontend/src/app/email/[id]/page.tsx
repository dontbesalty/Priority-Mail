"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getEmail, actionEmail, Email } from "@/lib/api";

const PRIORITY_STYLES: Record<string, string> = {
  High: "bg-red-100 text-red-700 border border-red-200",
  Medium: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  Low: "bg-gray-100 text-gray-500 border border-gray-200",
};

function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  if (source === "gmail")
    return (
      <span className="text-xs px-2 py-0.5 rounded font-medium bg-blue-100 text-blue-700 border border-blue-200">
        Gmail
      </span>
    );
  if (source === "o365")
    return (
      <span className="text-xs px-2 py-0.5 rounded font-medium bg-cyan-100 text-cyan-700 border border-cyan-200">
        Outlook
      </span>
    );
  return (
    <span className="text-xs px-2 py-0.5 rounded font-medium bg-gray-100 text-gray-500 border border-gray-200">
      {source}
    </span>
  );
}

export default function EmailDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [email, setEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [actioning, setActioning] = useState(false);

  useEffect(() => {
    getEmail(id).then(setEmail).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  async function handleAction(action: "approved" | "dismissed" | "corrected") {
    if (!email) return;
    setActioning(true);
    try {
      await actionEmail(email.id, action);
      router.push("/");
    } finally {
      setActioning(false);
    }
  }

  function copyReply() {
    if (email?.reply_draft) {
      navigator.clipboard.writeText(email.reply_draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-gray-400">Loading…</div>;
  }
  if (!email) {
    return <div className="py-16 text-center text-red-500">Email not found.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to inbox
      </button>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold">{email.subject}</h1>
          <span
            className={`text-xs px-2 py-1 rounded font-medium shrink-0 ${PRIORITY_STYLES[email.priority]}`}
          >
            {email.priority}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm text-gray-500">
            From: <span className="font-medium text-gray-700">{email.from_address}</span>
          </p>
          <SourceBadge source={email.source} />
        </div>
        {email.received_at && (
          <p className="text-xs text-gray-400 mt-0.5">
            {new Date(email.received_at).toLocaleString()}
          </p>
        )}
      </div>

      {/* Classification */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm space-y-2">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          AI Classification
        </h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500">Category</dt>
          <dd className="font-medium">{email.category}</dd>
          <dt className="text-gray-500">Reason</dt>
          <dd className="text-gray-700">{email.priority_reason}</dd>
          <dt className="text-gray-500">Confidence</dt>
          <dd>{Math.round((email.confidence ?? 0) * 100)}%</dd>
          <dt className="text-gray-500">Classified by</dt>
          <dd className="capitalize">{email.classified_by}</dd>
          {email.rule_fired && (
            <>
              <dt className="text-gray-500">Rule</dt>
              <dd className="text-xs font-mono">{email.rule_fired}</dd>
            </>
          )}
        </div>
      </div>

      {/* Task */}
      {email.task_needed && email.task_title && (
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-yellow-800 uppercase tracking-wide mb-2">
            Suggested Task
          </h2>
          <p className="font-medium text-gray-800">{email.task_title}</p>
          {email.due_date_guess && (
            <p className="text-sm text-gray-500 mt-1">
              Due: {new Date(email.due_date_guess).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {/* Reply draft */}
      {email.reply_needed && email.reply_draft && (
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-blue-800 uppercase tracking-wide">
              Suggested Reply
            </h2>
            <button
              onClick={copyReply}
              className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{email.reply_draft}</p>
        </div>
      )}

      {/* Body */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Email Body
        </h2>
        <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
          {email.body || email.snippet}
        </pre>
      </div>

      {/* Actions */}
      {!email.user_action ? (
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm flex gap-3 flex-wrap">
          <button
            onClick={() => handleAction("approved")}
            disabled={actioning}
            className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            ✅ Approve
          </button>
          <button
            onClick={() => handleAction("dismissed")}
            disabled={actioning}
            className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300 disabled:opacity-50 transition-colors"
          >
            ❌ Dismiss
          </button>
        </div>
      ) : (
        <div className="text-sm text-gray-400 text-center py-2">
          Actioned: <span className="capitalize font-medium">{email.user_action}</span>
        </div>
      )}
    </div>
  );
}
