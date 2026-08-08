/**
 * Persistenz der UI-Einstellungen
 *
 * Die Plugin-Settings sind eine reine UI-Präferenz und liegen deshalb im
 * Local Storage, nicht im Worker-State. Zuvor existierte diese Logik doppelt
 * in `App.tsx` und `exports.tsx`.
 */

import type { PluginSettings } from '@shared/types';
import { DEFAULT_PLUGIN_SETTINGS } from '@shared/types';

export const SETTINGS_STORAGE_KEY = 'scrum-plugin-settings';

/**
 * Lädt die Einstellungen.
 *
 * Gespeicherte Werte werden über die Defaults gelegt, damit ein Stand aus
 * einer älteren Version keine fehlenden Felder hinterlässt.
 */
export function loadSettingsFromStorage(): PluginSettings {
  try {
    const stored = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return DEFAULT_PLUGIN_SETTINGS;

    const parsed = JSON.parse(stored) as Partial<PluginSettings>;
    return {
      ...DEFAULT_PLUGIN_SETTINGS,
      ...parsed,
      teamSize: { ...DEFAULT_PLUGIN_SETTINGS.teamSize, ...parsed.teamSize },
      wipLimits: { ...DEFAULT_PLUGIN_SETTINGS.wipLimits, ...parsed.wipLimits },
      sprint: { ...DEFAULT_PLUGIN_SETTINGS.sprint, ...parsed.sprint },
      events: { ...DEFAULT_PLUGIN_SETTINGS.events, ...parsed.events },
    };
  } catch (err) {
    console.warn('[Settings] Konnten nicht geladen werden:', err);
    return DEFAULT_PLUGIN_SETTINGS;
  }
}

/**
 * Speichert die Einstellungen.
 */
export function saveSettingsToStorage(settings: PluginSettings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[Settings] Konnten nicht gespeichert werden:', err);
  }
}
