import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Agent Network",
  description: "Your identity. Your agent. Your world.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
