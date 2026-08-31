import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import { ThemeSystemProvider } from "@/contexts/ThemeSystemProvider";
import { getThemeBootstrapScript } from "@/lib/theme/bootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zeta Web",
  description: "Zeta's browser interface for the coding agent",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className="dark notranslate" data-theme="dark" data-theme-id="zeta-dark" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <meta name="theme-color" content="#111827" />
        <script dangerouslySetInnerHTML={{ __html: getThemeBootstrapScript() }} />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        <ThemeSystemProvider>{children}</ThemeSystemProvider>
      </body>
    </html>
  );
}
