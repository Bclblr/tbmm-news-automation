import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TBMM Haber Otomasyonu",
  description: "TBMM resmi haberlerini takip eden kişisel otomasyon paneli",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}