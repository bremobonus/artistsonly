import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artists Only",
  description: "artistsonly.io",
  metadataBase: new URL("https://artistsonly.io"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
