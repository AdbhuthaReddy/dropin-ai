import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import InventorySync from "@/components/InventorySync";
import DemoIdentity from "@/components/DemoIdentity";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DropIn.ai | Supply Intelligence",
  description: "Prototype for AI-assisted electronic-component shortage analysis.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><DemoIdentity /><InventorySync />{children}</body>
    </html>
  );
}
