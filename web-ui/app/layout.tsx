import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import { ThemeSystemProvider } from "@/contexts/ThemeSystemProvider";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import { getThemeBootstrapScript } from "@/lib/theme/bootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zeta Web",
  description: "Zeta's browser interface for the coding agent",
  // Installable on a phone from the user's own serve endpoint. The manifest
  // and icons are static files under public/, so no external origin is needed.
  applicationName: "Zeta",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Zeta",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      translate="no"
      className="dark notranslate"
      data-theme="dark"
      data-theme-id="zeta-dark"
      suppressHydrationWarning
    >
      <head>
        <meta name="google" content="notranslate" />
        <meta name="theme-color" content="#111827" />
        <script
          dangerouslySetInnerHTML={{ __html: getThemeBootstrapScript() }}
        />
      </head>
      <body translate="no" className="notranslate">
        <ThemeSystemProvider>{children}</ThemeSystemProvider>
        <PwaRegistrar />
      </body>
    </html>
  );
}
