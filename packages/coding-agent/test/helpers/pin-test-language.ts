import { setLanguage } from "../../src/i18n";

/**
 * Pin every coding-agent test run to English.
 *
 * The i18n catalogue resolves lazily through `detectLanguage`, whose last
 * fallback is the OS locale — on a Chinese-system Windows box every
 * message-copy assertion written against English strings would fail. Tests
 * that exercise zh explicitly call `setLanguage("zh")` themselves (and the
 * settings-localization suite restores en in its afterEach).
 */
setLanguage("en");
