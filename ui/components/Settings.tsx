/**
 * Settings Component
 *
 * Plugin-Konfiguration UI gemäß Phase 3.3.
 * Ermöglicht die Anpassung von:
 * - Team-Größe (1-5 Developer)
 * - WIP-Limits pro Spalte
 * - Sprint-Länge (1-4 Wochen)
 * - Daily Scrum Zeit
 * - Event-Trigger aktivieren/deaktivieren
 */

import { useState, useCallback } from 'react';
import type { PluginSettings, TeamSizeConfig, WipLimitsConfig, SprintConfig, EventsConfig } from '@shared/types';
import { DEFAULT_PLUGIN_SETTINGS } from '@shared/types';

interface SettingsProps {
  /** Aktuelle Settings */
  settings: PluginSettings;
  /** Callback wenn Settings geändert werden */
  onSettingsChange: (settings: PluginSettings) => void;
  /** Callback zum Schließen des Modals */
  onClose: () => void;
  /** Ob das Modal sichtbar ist */
  isOpen: boolean;
}

/**
 * Validierungsgrenzen
 */
const VALIDATION = {
  developerCount: { min: 1, max: 5 },
  wipLimits: { min: 1, max: 50 },
  sprintLength: { min: 1, max: 4 },
};

/**
 * Settings Modal Component
 */
export function Settings({ settings, onSettingsChange, onClose, isOpen }: SettingsProps) {
  // Lokaler State für das Formular
  const [localSettings, setLocalSettings] = useState<PluginSettings>(settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Update Team Size
  const updateTeamSize = useCallback((updates: Partial<TeamSizeConfig>) => {
    setLocalSettings((prev) => ({
      ...prev,
      teamSize: { ...prev.teamSize, ...updates },
    }));
    setHasChanges(true);
  }, []);

  // Update WIP Limits
  const updateWipLimits = useCallback((updates: Partial<WipLimitsConfig>) => {
    setLocalSettings((prev) => ({
      ...prev,
      wipLimits: { ...prev.wipLimits, ...updates },
    }));
    setHasChanges(true);
  }, []);

  // Update Sprint Config
  const updateSprintConfig = useCallback((updates: Partial<SprintConfig>) => {
    setLocalSettings((prev) => ({
      ...prev,
      sprint: { ...prev.sprint, ...updates },
    }));
    setHasChanges(true);
  }, []);

  // Update Events Config
  const updateEventsConfig = useCallback((updates: Partial<EventsConfig>) => {
    setLocalSettings((prev) => ({
      ...prev,
      events: { ...prev.events, ...updates },
    }));
    setHasChanges(true);
  }, []);

  // Validierung
  const validateSettings = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    // Developer Count
    if (
      localSettings.teamSize.developerCount < VALIDATION.developerCount.min ||
      localSettings.teamSize.developerCount > VALIDATION.developerCount.max
    ) {
      newErrors.developerCount = `Muss zwischen ${VALIDATION.developerCount.min} und ${VALIDATION.developerCount.max} sein`;
    }

    // WIP Limits
    ['todo', 'development', 'review'].forEach((key) => {
      const value = localSettings.wipLimits[key as keyof WipLimitsConfig];
      if (value < VALIDATION.wipLimits.min || value > VALIDATION.wipLimits.max) {
        newErrors[`wip_${key}`] = `Muss zwischen ${VALIDATION.wipLimits.min} und ${VALIDATION.wipLimits.max} sein`;
      }
    });

    // Sprint Length
    if (
      localSettings.sprint.lengthWeeks < VALIDATION.sprintLength.min ||
      localSettings.sprint.lengthWeeks > VALIDATION.sprintLength.max
    ) {
      newErrors.sprintLength = `Muss zwischen ${VALIDATION.sprintLength.min} und ${VALIDATION.sprintLength.max} Wochen sein`;
    }

    // Die Event-Trigger sind reine Schalter — nichts zu validieren.

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [localSettings]);

  // Speichern
  const handleSave = useCallback(() => {
    if (validateSettings()) {
      onSettingsChange(localSettings);
      setHasChanges(false);
      onClose();
    }
  }, [localSettings, onSettingsChange, onClose, validateSettings]);

  // Zurücksetzen auf Defaults
  const handleReset = useCallback(() => {
    setLocalSettings(DEFAULT_PLUGIN_SETTINGS);
    setErrors({});
    setHasChanges(true);
  }, []);

  // Abbrechen
  const handleCancel = useCallback(() => {
    setLocalSettings(settings);
    setErrors({});
    setHasChanges(false);
    onClose();
  }, [settings, onClose]);

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={handleCancel}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-header">
          <h2>⚙️ Einstellungen</h2>
          <button className="btn-close" onClick={handleCancel} title="Schließen">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="settings-content">
          {/* Team-Größe Section */}
          <section className="settings-section">
            <h3>👥 Team-Größe</h3>
            <div className="settings-field">
              <label htmlFor="developerCount">Anzahl Developer</label>
              <div className="input-with-hint">
                <input
                  type="number"
                  id="developerCount"
                  min={VALIDATION.developerCount.min}
                  max={VALIDATION.developerCount.max}
                  value={localSettings.teamSize.developerCount}
                  onChange={(e) => updateTeamSize({ developerCount: parseInt(e.target.value) || 1 })}
                  className={errors.developerCount ? 'input-error' : ''}
                />
                <span className="hint">1-5 Developer</span>
              </div>
              {errors.developerCount && <span className="error-message">{errors.developerCount}</span>}
            </div>
          </section>

          {/* WIP-Limits Section */}
          <section className="settings-section">
            <h3>📋 WIP-Limits</h3>
            <p className="section-description">Work-in-Progress Limits pro Spalte begrenzen parallele Arbeit.</p>

            <div className="settings-field">
              <label htmlFor="wipTodo">Todo-Spalte</label>
              <div className="input-with-hint">
                <input
                  type="number"
                  id="wipTodo"
                  min={VALIDATION.wipLimits.min}
                  max={VALIDATION.wipLimits.max}
                  value={localSettings.wipLimits.todo}
                  onChange={(e) => updateWipLimits({ todo: parseInt(e.target.value) || 1 })}
                  className={errors.wip_todo ? 'input-error' : ''}
                />
                <span className="hint">Default: 10</span>
              </div>
              {errors.wip_todo && <span className="error-message">{errors.wip_todo}</span>}
            </div>

            <div className="settings-field">
              <label htmlFor="wipDevelopment">Development (In Progress)</label>
              <div className="input-with-hint">
                <input
                  type="number"
                  id="wipDevelopment"
                  min={VALIDATION.wipLimits.min}
                  max={VALIDATION.wipLimits.max}
                  value={localSettings.wipLimits.development}
                  onChange={(e) => updateWipLimits({ development: parseInt(e.target.value) || 1 })}
                  className={errors.wip_development ? 'input-error' : ''}
                />
                <span className="hint">Default: 4</span>
              </div>
              {errors.wip_development && <span className="error-message">{errors.wip_development}</span>}
            </div>

            <div className="settings-field">
              <label htmlFor="wipReview">Review-Spalte</label>
              <div className="input-with-hint">
                <input
                  type="number"
                  id="wipReview"
                  min={VALIDATION.wipLimits.min}
                  max={VALIDATION.wipLimits.max}
                  value={localSettings.wipLimits.review}
                  onChange={(e) => updateWipLimits({ review: parseInt(e.target.value) || 1 })}
                  className={errors.wip_review ? 'input-error' : ''}
                />
                <span className="hint">Default: 3</span>
              </div>
              {errors.wip_review && <span className="error-message">{errors.wip_review}</span>}
            </div>
          </section>

          {/* Sprint-Konfiguration Section */}
          <section className="settings-section">
            <h3>🏃 Sprint-Konfiguration</h3>

            <div className="settings-field">
              <label htmlFor="sprintLength">Sprint-Länge (Wochen)</label>
              <div className="input-with-hint">
                <input
                  type="number"
                  id="sprintLength"
                  min={VALIDATION.sprintLength.min}
                  max={VALIDATION.sprintLength.max}
                  value={localSettings.sprint.lengthWeeks}
                  onChange={(e) => updateSprintConfig({ lengthWeeks: parseInt(e.target.value) || 1 })}
                  className={errors.sprintLength ? 'input-error' : ''}
                />
                <span className="hint">1-4 Wochen</span>
              </div>
              {errors.sprintLength && <span className="error-message">{errors.sprintLength}</span>}
            </div>
          </section>

          {/* Event-Trigger Section */}
          <section className="settings-section">
            <h3>⚡ Event-Trigger</h3>
            <p className="section-description">
              Zeremonien werden durch den Board-Zustand ausgelöst, nicht durch Uhrzeiten. Hier
              lässt sich einstellen, welche Trigger greifen.
            </p>

            <div className="settings-field settings-toggle">
              <label htmlFor="enableAutoPlanning">
                <input
                  type="checkbox"
                  id="enableAutoPlanning"
                  checked={localSettings.events.enableAutoPlanning}
                  onChange={(e) => updateEventsConfig({ enableAutoPlanning: e.target.checked })}
                />
                <span className="toggle-label">Automatische Sprint-Planung</span>
              </label>
              <span className="toggle-description">
                Startet das Planning, sobald TODO leerläuft und sprintreife Tickets bereitliegen.
              </span>
            </div>

            <div className="settings-field settings-toggle">
              <label htmlFor="enableAutoRefinement">
                <input
                  type="checkbox"
                  id="enableAutoRefinement"
                  checked={localSettings.events.enableAutoRefinement}
                  onChange={(e) => updateEventsConfig({ enableAutoRefinement: e.target.checked })}
                />
                <span className="toggle-label">Automatisches Backlog Refinement</span>
              </label>
              <span className="toggle-description">
                Startet das Refinement, wenn der Vorrat an sprintreifen Tickets zur Neige geht.
              </span>
            </div>

            <div className="settings-field settings-toggle">
              <label htmlFor="enableAutoImpediments">
                <input
                  type="checkbox"
                  id="enableAutoImpediments"
                  checked={localSettings.events.enableAutoImpediments}
                  onChange={(e) => updateEventsConfig({ enableAutoImpediments: e.target.checked })}
                />
                <span className="toggle-label">Blocker &amp; Leerlauf automatisch beheben</span>
              </label>
              <span className="toggle-description">
                Hebt aufgelöste Blockaden auf, eskaliert echte Blocker und weist freien Entwicklern wartende Tickets zu.
              </span>
            </div>

            <div className="settings-field settings-toggle">
              <label htmlFor="enableAutoReview">
                <input
                  type="checkbox"
                  id="enableAutoReview"
                  checked={localSettings.events.enableAutoReview}
                  onChange={(e) => updateEventsConfig({ enableAutoReview: e.target.checked })}
                />
                <span className="toggle-label">Automatisches Review &amp; Retrospektive</span>
              </label>
              <span className="toggle-description">
                Startet das Sprint Review, sobald alle Sprint-Tickets fertig sind; die
                Retrospektive folgt.
              </span>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <button className="btn btn-secondary" onClick={handleReset} title="Auf Standardwerte zurücksetzen">
            🔄 Zurücksetzen
          </button>
          <div className="footer-actions">
            <button className="btn btn-ghost" onClick={handleCancel}>
              Abbrechen
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={!hasChanges}>
              💾 Speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
