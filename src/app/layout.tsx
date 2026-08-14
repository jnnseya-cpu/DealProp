import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lode — Property Deal OS",
  description:
    "Problems become deals. Deals find capital. Capital closes property. An AI deal engine for motivated sellers, dealmakers and funders.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">{children}</body>
    </html>
  );
}
