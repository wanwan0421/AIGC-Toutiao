import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "../components/top-nav";

export const metadata: Metadata = {
  title: "AI Creator Platform",
  description: "AIGC creator production and distribution platform"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-w-80 bg-app-bg text-app-text antialiased">
        <TopNav />
        <main className="w-full">{children}</main>
      </body>
    </html>
  );
}
