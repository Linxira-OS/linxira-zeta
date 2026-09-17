import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import { ThemeSystemProvider } from "@/contexts/ThemeSystemProvider";
import { getThemeBootstrapScript } from "@/lib/theme/bootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zeta Web",
  description: "Zeta's browser interface for the coding agent",
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
      </body>
    </html>
  );
}
