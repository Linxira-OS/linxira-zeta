import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts'
import './index.css'
import App from './App.tsx'
import { ThemeSystemProvider } from './contexts/ThemeSystemContext'
import { ThemeProvider } from './components/providers/ThemeProvider'
import './lib/debug'
import { syncDesktopSettings, initializeAppearancePreferences } from './lib/persistence'
import { startAppearanceAutoSave } from './lib/appearanceAutoSave'
import { applyPersistedDirectoryPreferences } from './lib/directoryPersistence'
import { startTypographyWatcher } from './lib/typographyWatcher'
import { startModelPrefsAutoSave } from './lib/modelPrefsAutoSave'
import { initializeLocale, I18nProvider } from './lib/i18n'
import type { RuntimeAPIs } from './lib/api/types'
import { createZetaRuntimeApis } from './lib/zeta/ZetaRuntimeApis'
import { startZetaProjectSync } from './lib/zeta/projectSync'
// Zeta hosts this UI directly: the gateway serves `/api/*`, so the runtime
// APIs are constructed here instead of being injected by an Express host.
declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

const runtimeAPIs: RuntimeAPIs = createZetaRuntimeApis();
initializeLocale();
startZetaProjectSync();


// Initialize settings asynchronously — the app renders with defaults first
// and hydrates once persisted preferences are applied.
void initializeAppearancePreferences().then(() => {
  void Promise.all([
    syncDesktopSettings(),
    applyPersistedDirectoryPreferences(),
  ]).catch((err) => {
    console.error('[main] settings init failed:', err);
  });

  startAppearanceAutoSave();
  startModelPrefsAutoSave();
  startTypographyWatcher();
}).catch((err) => {
  console.error('[main] appearance init failed:', err);
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <ThemeSystemProvider>
        <ThemeProvider>
          {/* SessionAuthGate requires an OpenChamber /auth/session backend;
              zeta remote access authenticates via the X-Zeta-Token fetch
              patch instead, so the gate is bypassed. */}
          <App apis={runtimeAPIs} />
        </ThemeProvider>
      </ThemeSystemProvider>
    </I18nProvider>
  </StrictMode>,
);
