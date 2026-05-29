import type { Metadata } from "next";
import "./globals.css";
import { RouteAuthGate } from "../components/route-auth-gate";
import { Sidebar } from "../components/sidebar";
import { TopHeader } from "../components/top-header";

export const metadata: Metadata = {
  title: "今日头条创作服务平台",
  description: "AI creator production and distribution platform"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="flex min-h-screen flex-col overflow-hidden text-app-text antialiased">
        <TopHeader />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <RouteAuthGate>
              <div className="relative">{children}</div>
            </RouteAuthGate>
          </main>
        </div>
      </body>
    </html>
  );
}
