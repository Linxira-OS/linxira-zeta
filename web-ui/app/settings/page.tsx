import { redirect } from "next/navigation";

/**
 * Settings lives inside the AppShell as a modal, not a route. Send `/settings`
 * deep links (e.g. the desktop tray menu) to the panel query the shell reads.
 * A server redirect (no client JS) keeps the deep link reliable in the
 * Electron shell where the tray loads this URL directly.
 */
export default function SettingsRedirect() {
  redirect("/?panel=settings");
}
