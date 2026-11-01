import nativesNotices from "@linxiraos/pi-natives/THIRD-PARTY-NOTICES.txt" with { type: "text" };
import rootLicense from "../tools/browser/relay/extension-assets/LICENSE.txt" with { type: "text" };
import thirdPartyNotices from "../tools/browser/relay/extension-assets/THIRD-PARTY-NOTICES.txt" with { type: "text" };

/**
 * `zetacode --license` output: the Zeta license, then the notices of the two components the executable embeds — the
 * CLI and the native addon.
 */
export function formatLicenseOutput(): string {
	const sections = [rootLicense, thirdPartyNotices, nativesNotices].map(text => text.trimEnd());
	return `Zeta License and Third-Party Notices\n\n${sections.join("\n\n")}\n`;
}
