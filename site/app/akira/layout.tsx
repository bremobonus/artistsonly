import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Akira — operations",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AkiraLayout({ children }: { children: React.ReactNode }) {
  return children;
}
