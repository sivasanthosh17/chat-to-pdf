/**
 * Per-browser download preferences (remembered convenience only — never
 * required for the app to work). Storage can be unavailable (private mode,
 * blocked site data), so every access is guarded.
 */

const KEY = 'chatpdf.downloadPrefs';

export function loadDownloadPrefs() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    return { includeVerificationSummary: saved.includeVerificationSummary === true };
  } catch {
    return { includeVerificationSummary: false };
  }
}

export function saveDownloadPrefs(prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ includeVerificationSummary: prefs.includeVerificationSummary === true }));
  } catch {
    // Not remembered; the choice still applies to this download
  }
}
