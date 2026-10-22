// Per-viewer settings kept in this browser. Storage can throw or come back empty, so every access is wrapped.

const AUTO_KEY = 'ai-ice.si.autoAdvance'

/** Big calls and fight results wait for a tap on Continue unless auto-advance is on (Nero: "Sometimes I want to read"). */
export function loadAutoAdvance(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1'
  } catch {
    return false
  }
}

export function saveAutoAdvance(on: boolean) {
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0') } catch { /* per-viewer convenience only */ }
}
