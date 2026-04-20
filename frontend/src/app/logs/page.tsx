import Link from "next/link";
import { getLogs, LogEntry } from "@/lib/api";

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 1000 / 3600;
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function LevelBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    info: "bg-blue-100 text-blue-700 border-blue-200",
    warn: "bg-yellow-100 text-yellow-700 border-yellow-200",
    error: "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${styles[level] || "bg-gray-100 text-gray-700 border-gray-200"}`}>
      {level.toUpperCase()}
    </span>
  );
}

export default async function LogsPage() {
  const logs = await getLogs();

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Connector Logs</h1>
          <p className="text-gray-500 mt-1">Troubleshoot rules and triage pipeline performance</p>
        </div>
        <Link 
          href="/"
          className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
        >
          ← Back to Inbox
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Time</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Level</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Source</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600">Message</th>
                <th className="px-6 py-4 text-sm font-semibold text-gray-600 outline-none">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 italic">
                    No logs found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {relativeDate(log.timestamp)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <LevelBadge level={log.level} />
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-700 whitespace-nowrap">
                      {log.source}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-800">
                      {log.message}
                    </td>
                    <td className="px-6 py-4">
                      {log.metadata && Object.keys(log.metadata).length > 0 ? (
                        <div className="group relative">
                           <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded cursor-help">
                             {Object.keys(log.metadata).length} fields
                           </span>
                           <div className="hidden group-hover:block absolute right-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-[10px] rounded-lg shadow-xl z-10 font-mono whitespace-pre-wrap">
                             {JSON.stringify(log.metadata, null, 2)}
                           </div>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
