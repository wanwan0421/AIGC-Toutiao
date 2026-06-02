import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../components/auth-provider";
import { RouteAuthGate } from "../components/route-auth-gate";
import { Sidebar } from "../components/sidebar";
import { TopHeader } from "../components/top-header";

export const metadata: Metadata = {
  title: "今日头条创作服务平台",
  description: "AI 创作者辅助生产与分发平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="flex h-full flex-col overflow-hidden text-app-text antialiased">
        <AuthProvider>
          <TopHeader />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <Sidebar />
            <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <RouteAuthGate>
                <div className="relative">{children}</div>
              </RouteAuthGate>
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
