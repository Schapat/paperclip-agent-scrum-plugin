/**
 * Unit Tests für Settings Persistence
 *
 * Phase 3.3: Konfigurierbare Einstellungen
 */

import { describe, it, expect } from 'vitest';
import {
  validateAndMergeSettings,
  serializeSettings,
  deserializeSettings,
  validateSettings,
  DEFAULT_PLUGIN_SETTINGS,
  SETTINGS_VALIDATION,
} from '../settings';
import type { PluginSettings } from '../types';

describe('Settings Utilities', () => {
  describe('validateAndMergeSettings', () => {
    it('should return defaults when given empty object', () => {
      const result = validateAndMergeSettings({});
      expect(result).toEqual(DEFAULT_PLUGIN_SETTINGS);
    });

    it('should merge partial settings with defaults', () => {
      const partial = {
        teamSize: { developerCount: 4 },
      };
      const result = validateAndMergeSettings(partial);

      expect(result.teamSize.developerCount).toBe(4);
      // Other fields should be defaults
      expect(result.wipLimits).toEqual(DEFAULT_PLUGIN_SETTINGS.wipLimits);
      expect(result.sprint).toEqual(DEFAULT_PLUGIN_SETTINGS.sprint);
      expect(result.events).toEqual(DEFAULT_PLUGIN_SETTINGS.events);
    });

    it('should deeply merge nested objects', () => {
      const partial: Partial<PluginSettings> = {
        wipLimits: { todo: 20, development: 4, review: 3 }, // Provide full object
      };
      const result = validateAndMergeSettings(partial);

      expect(result.wipLimits.todo).toBe(20);
      expect(result.wipLimits.development).toBe(4);
      expect(result.wipLimits.review).toBe(3);
    });

    it('should preserve all custom values', () => {
      const custom: PluginSettings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        teamSize: { developerCount: 5 },
        wipLimits: { todo: 15, development: 6, review: 5 },
        sprint: { lengthWeeks: 3 },
        events: {
          enableAutoPlanning: false,
          enableAutoRefinement: true,
          enableAutoImpediments: true,
          enableAutoReview: false,
        },
      };

      const result = validateAndMergeSettings(custom);
      expect(result).toEqual(custom);
    });
  });

  describe('serializeSettings / deserializeSettings', () => {
    it('should serialize and deserialize settings correctly', () => {
      const settings: PluginSettings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        teamSize: { developerCount: 3 },
        events: { ...DEFAULT_PLUGIN_SETTINGS.events, enableAutoPlanning: false },
      };

      const serialized = serializeSettings(settings);
      const deserialized = deserializeSettings(serialized);

      expect(deserialized).toEqual(settings);
    });

    it('should handle invalid JSON gracefully', () => {
      const result = deserializeSettings('invalid json{');
      expect(result).toEqual(DEFAULT_PLUGIN_SETTINGS);
    });

    it('should handle empty string', () => {
      const result = deserializeSettings('');
      expect(result).toEqual(DEFAULT_PLUGIN_SETTINGS);
    });
  });

  describe('validateSettings', () => {
    it('should return no errors for default settings', () => {
      const errors = validateSettings(DEFAULT_PLUGIN_SETTINGS);
      expect(errors).toEqual([]);
    });

    it('should return no errors for valid custom settings', () => {
      const settings: PluginSettings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        teamSize: { developerCount: 5 },
        wipLimits: { todo: 20, development: 8, review: 6 },
        sprint: { lengthWeeks: 4 },
        events: {
          enableAutoPlanning: true,
          enableAutoRefinement: false,
          enableAutoImpediments: false,
          enableAutoReview: true,
        },
      };

      const errors = validateSettings(settings);
      expect(errors).toEqual([]);
    });

    it('should detect invalid developerCount (too low)', () => {
      const settings: PluginSettings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        teamSize: { developerCount: 0 },
      };

      const errors = validateSettings(settings);
      expect(errors).toContain(
        `developerCount must be between ${SETTINGS_VALIDATION.developerCount.min} and ${SETTINGS_VALIDATION.developerCount.max}`
      );
    });

    it('should detect invalid developerCount (too high)', () => {
      const settings: PluginSettings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        teamSize: { developerCount: 10 },
      };

      const errors = validateSettings(settings);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('developerCount');
    });

    it('should detect invalid WIP limits', () => {
      const settings: PluginSettings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        wipLimits: { todo: 0, development: 100, review: -1 },
      };

      const errors = validateSettings(settings);
      expect(errors.length).toBe(3);
      expect(errors.some((e) => e.includes('wipLimits.todo'))).toBe(true);
      expect(errors.some((e) => e.includes('wipLimits.development'))).toBe(true);
      expect(errors.some((e) => e.includes('wipLimits.review'))).toBe(true);
    });

    it('should detect invalid sprint length', () => {
      const settings: PluginSettings = {
        ...DEFAULT_PLUGIN_SETTINGS,
        sprint: { lengthWeeks: 8 },
      };

      const errors = validateSettings(settings);
      expect(errors).toContain(
        `sprint.lengthWeeks must be between ${SETTINGS_VALIDATION.sprintLength.min} and ${SETTINGS_VALIDATION.sprintLength.max}`
      );
    });

    it('should not reject any combination of event toggles', () => {
      // Die Event-Konfiguration besteht nur noch aus Schaltern — jede
      // Kombination ist gueltig, es gibt keine Uhrzeit mehr zu validieren.
      for (const value of [true, false]) {
        const settings: PluginSettings = {
          ...DEFAULT_PLUGIN_SETTINGS,
          events: {
            enableAutoPlanning: value,
            enableAutoRefinement: value,
            enableAutoImpediments: value,
            enableAutoReview: value,
          },
        };

        expect(validateSettings(settings)).toEqual([]);
      }
    });
  });

  describe('SETTINGS_VALIDATION constants', () => {
    it('should have correct bounds for developerCount', () => {
      expect(SETTINGS_VALIDATION.developerCount.min).toBe(1);
      expect(SETTINGS_VALIDATION.developerCount.max).toBe(5);
    });

    it('should have correct bounds for wipLimits', () => {
      expect(SETTINGS_VALIDATION.wipLimits.min).toBe(1);
      expect(SETTINGS_VALIDATION.wipLimits.max).toBe(50);
    });

    it('should have correct bounds for sprintLength', () => {
      expect(SETTINGS_VALIDATION.sprintLength.min).toBe(1);
      expect(SETTINGS_VALIDATION.sprintLength.max).toBe(4);
    });

  });

  describe('DEFAULT_PLUGIN_SETTINGS', () => {
    it('should have valid default values', () => {
      const errors = validateSettings(DEFAULT_PLUGIN_SETTINGS);
      expect(errors).toEqual([]);
    });

    it('should have expected default values', () => {
      expect(DEFAULT_PLUGIN_SETTINGS.teamSize.developerCount).toBe(2);
      expect(DEFAULT_PLUGIN_SETTINGS.wipLimits.todo).toBe(10);
      expect(DEFAULT_PLUGIN_SETTINGS.wipLimits.development).toBe(4);
      expect(DEFAULT_PLUGIN_SETTINGS.wipLimits.review).toBe(3);
      expect(DEFAULT_PLUGIN_SETTINGS.sprint.lengthWeeks).toBe(2);
      expect(DEFAULT_PLUGIN_SETTINGS.events.enableAutoPlanning).toBe(true);
      expect(DEFAULT_PLUGIN_SETTINGS.events.enableAutoRefinement).toBe(true);
      expect(DEFAULT_PLUGIN_SETTINGS.events.enableAutoImpediments).toBe(true);
      expect(DEFAULT_PLUGIN_SETTINGS.events.enableAutoReview).toBe(true);
    });
  });
});
