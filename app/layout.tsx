import type { Metadata } from "next";
import { Bitter, Saira } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${saira.variable} ${bitter.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Finlandica:ital,wght@0,400..700;1,400..700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-dvh flex flex-col bg-background text-on-background selection:bg-secondary-container selection:text-on-secondary-container"
        style={{ ["--font-finlandica" as string]: "'Finlandica', sans-serif" }}
      >
        {children}
      </body>
    </html>
  );
}
