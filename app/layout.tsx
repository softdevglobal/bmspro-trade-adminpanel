import { connection } from "next/server";
import type { Metadata } from "next";
import { Bitter, Saira } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const saira = Saira({
  subsets: ["latin"],
  variable: "--font-saira",
  display: "swap",
});

const bitter = Bitter({
  subsets: ["latin"],
  variable: "--font-bitter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BMS Pro Trade",
  description: "Admin portal for BMS Pro Trade",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  return (
    <html lang="en" className={`${saira.variable} ${bitter.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* These load on every page: this is the root App Router layout, not a
            single page (the rule targets the old pages/ router). Finlandica is not
            available through next/font, so it is linked directly. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Finlandica:ital,wght@0,400..700;1,400..700&display=swap"
          rel="stylesheet"
        />
        {/* Icon font: display=block (Google's recommendation for Material
            Symbols) hides icon names like "home" until the font has loaded. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/google-font-display */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-dvh flex flex-col bg-background text-on-background selection:bg-secondary-container selection:text-on-secondary-container"
        style={{ ["--font-finlandica" as string]: "'Finlandica', sans-serif" }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
