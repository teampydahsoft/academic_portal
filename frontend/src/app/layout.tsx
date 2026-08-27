import type { Metadata, Viewport } from "next";
import { Source_Sans_3 } from "next/font/google";
import { PwaInstallProvider } from "@/components/pwa/PwaInstallProvider";
import "./globals.css";

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  applicationName: "Pydah Academic Portal",
  title: "Pydah Academic Portal",
  description: "Pydah Group Academic Portal",
  icons: {
    icon: [
      { url: "/branding/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/branding/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/branding/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/branding/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/branding/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "Academic Portal",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Pydah Academic Portal",
    description: "Pydah Group Academic Portal",
    siteName: "Pydah Academic Portal",
  },
};

export const viewport: Viewport = {
  themeColor: "#1f3a5f",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-dvh overflow-hidden" suppressHydrationWarning>
      <body
        className={`${sourceSans.variable} h-dvh overflow-hidden antialiased`}
        suppressHydrationWarning
      >
        <PwaInstallProvider>{children}</PwaInstallProvider>
      </body>
    </html>
  );
}
