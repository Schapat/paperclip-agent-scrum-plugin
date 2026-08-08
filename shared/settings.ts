/**
 * Settings Persistence Utilities
 *
 * Phase 3.3: Konfigurierbare Einstellungen persistieren
 *
 * Diese Utility ermöglicht das Speichern und Laden von Plugin-Settings
 * sowohl im Browser (localStorage) als auch im Worker-Kontext.
 */

import type { PluginSettings } from './types';
import { DEFAULT_PLUGIN_SETTINGS } from './types';

// Storage Key für Settings
const SETTINGS_STORAGE_KEY = 'scrum-plugin-settings';

/**
 * Validiert und merged Settings mit Defaults für Backwards-Compatibility
 */
export function validateAndMergeSettings(parsed: Partial<PluginSettings>): PluginSettings {
  return {
    ...DEFAULT_PLUGIN_SETTINGS,
    ...parsed,
    teamSize: {
      ...DEFAULT_PLUGIN_SETTINGS.teamSize,
      ...(parsed.teamSize || {}),
    },
    wipLimits: {
      ...DEFAULT_PLUGIN_SETTINGS.wipLimits,
      ...(parsed.wipLimits || {}),
    },
    sprint: {
      ...DEFAULT_PLUGIN_SETTINGS.sprint,
      ...(parsed.sprint || {}),
    },
    events: {
      ...DEFAULT_PLUGIN_SETTINGS.events,
      ...(parsed.events || {}),
    },
  };
}

/**
 * Lädt Settings aus localStorage (Browser-Kontext)
 */
export function loadSettingsFromLocalStorage(): PluginSettings {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_PLUGIN_SETTINGS;
    }

    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return validateAndMergeSettings(parsed);
    }
  } catch (err) {
    console.warn('[Settings] Failed to load settings from localStorage:', err);
  }
  return DEFAULT_PLUGIN_SETTINGS;
}

/**
 * Speichert Settings in localStorage (Browser-Kontext)
 */
export function saveSettingsToLocalStorage(settings: PluginSettings): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      console.warn('[Settings] localStorage not available');
      return false;
    }

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (err) {
    console.warn('[Settings] Failed to save settings to localStorage:', err);
    return false;
  }
}

/**
 * Serialisiert Settings für Persistenz
 */
export function serializeSettings(settings: PluginSettings): string {
  return JSON.stringify(settings);
}

/**
 * Deserialisiert Settings aus String
 */
export function deserializeSettings(data: string): PluginSettings {
  try {
    const parsed = JSON.parse(data);
    return validateAndMergeSettings(parsed);
  } catch (err) {
    console.warn('[Settings] Failed to deserialize settings:', err);
    return DEFAULT_PLUGIN_SETTINGS;
  }
}

/**
 * Validiert einzelne Settings-Werte
 */
export const SETTINGS_VALIDATION = {
  developerCount: { min: 1, max: 5 },
  wipLimits: { min: 1, max: 50 },
  sprintLength: { min: 1, max: 4 },
};

/**
 * Validiert ein PluginSettings-Objekt
 * @returns Array von Fehler-Messages, leer wenn valide
 */
export function validateSettings(settings: PluginSettings): string[] {
  const errors: string[] = [];

  // Team Size
  const devCount = settings.teamSize.developerCount;
  if (devCount < SETTINGS_VALIDATION.developerCount.min || devCount > SETTINGS_VALIDATION.developerCount.max) {
    errors.push(
      `developerCount must be between ${SETTINGS_VALIDATION.developerCount.min} and ${SETTINGS_VALIDATION.developerCount.max}`
    );
  }

  // WIP Limits
  const wipKeys = ['todo', 'development', 'review'] as const;
  for (const key of wipKeys) {
    const value = settings.wipLimits[key];
    if (value < SETTINGS_VALIDATION.wipLimits.min || value > SETTINGS_VALIDATION.wipLimits.max) {
      errors.push(
        `wipLimits.${key} must be between ${SETTINGS_VALIDATION.wipLimits.min} and ${SETTINGS_VALIDATION.wipLimits.max}`
      );
    }
  }

  // Sprint Length
  const sprintLength = settings.sprint.lengthWeeks;
  if (sprintLength < SETTINGS_VALIDATION.sprintLength.min || sprintLength > SETTINGS_VALIDATION.sprintLength.max) {
    errors.push(
      `sprint.lengthWeeks must be between ${SETTINGS_VALIDATION.sprintLength.min} and ${SETTINGS_VALIDATION.sprintLength.max}`
    );
  }

  // Die Event-Konfiguration besteht nur aus Schaltern — dort gibt es nichts zu
  // validieren. Zeremonien werden zustandsgesteuert ausgelöst, nicht per Uhrzeit.

  return errors;
}

// Re-export types and defaults for convenience
export { DEFAULT_PLUGIN_SETTINGS } from './types';
export type { PluginSettings, TeamSizeConfig, WipLimitsConfig, SprintConfig, EventsConfig } from './types';
