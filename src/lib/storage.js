// localStorage holds view preferences and nothing else. Training data lives on
// the calendar so it is the same on every device and survives a cleared browser.

const KEY = 'trainer.prefs.v1';

const DEFAULTS = {
  showSleep: false,
  showIgnored: false,
  expandedId: null,
};

export function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch { /* private mode, quota — preferences are not worth an error */ }
}
