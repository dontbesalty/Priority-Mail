import type { Metadata } from "next";
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
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight">📬 Priority Mail</span>
          <span className="text-sm text-gray-400">AI Email Triage</span>
        </header>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
