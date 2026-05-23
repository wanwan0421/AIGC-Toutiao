import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "../components/sidebar";

export const metadata: Metadata = {
  title: "AIGC-Toutiao - AI Creator Platform",
  description: "AIGC creator production and distribution platform"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="flex h-screen overflow-hidden bg-slate-50/50 text-app-text antialiased">
        <Sidebar />
        <main className="flex-1 h-screen overflow-y-auto relative">
          {children}
        </main>
      </body>
    </html>
  );
}
