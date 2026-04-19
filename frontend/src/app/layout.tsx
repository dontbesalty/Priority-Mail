import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Priority Mail",
  description: "AI email triage assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-tight">📬 Priority Mail</span>
            <span className="text-sm text-gray-400">AI Email Triage</span>
          </div>

          <nav className="flex items-center gap-4">
            <Link
              href="/"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              Inbox
            </Link>
            <Link
              href="/tasks"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              Task List
            </Link>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
