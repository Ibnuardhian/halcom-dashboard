import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { APP_NAME } from "@/config/app";
import { THEME_INIT_SCRIPT } from "@/features/theme/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Halcom internal project request and fulfillment tracker for Sales, SOA and Purchasing.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the head script may add the `dark` class before React hydrates.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
