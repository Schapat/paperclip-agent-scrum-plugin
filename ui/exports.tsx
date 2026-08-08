/**
 * Autonomous Scrum Team Plugin - Component Exports
 *
 * Library-Entry-Point: alles, was das Manifest als UI-Slot registriert, wird
 * hier exportiert (Page, Sidebar-Link, Settings-Page und die beiden
 * Dashboard-Widgets).
 *
 * Die Board-Logik selbst liegt im `ScrumBoardContainer`, damit Plugin-Seite
 * und Dev-Harness nicht auseinanderlaufen.
 */

import { useState, useCallback } from 'react';
import type { PluginContext } from '@paperclipai/plugin-sdk/ui';
import type { PluginSettings } from '@shared/types';
import { ScrumBoardContainer } from './components/ScrumBoardContainer';
import { useScrumBoard } from './hooks/useScrumBoard';
import { loadSettingsFromStorage, saveSettingsToStorage } from './lib/settings-storage';
import './styles/index.css';

// ============================================================================
// Constants
// ============================================================================

const PAGE_ROUTE = 'scrum-board';

// ============================================================================
// Types
// ============================================================================

export interface PluginPageProps {
  context: PluginContext;
}

// ============================================================================
// Main Page Component - ScrumBoardPage
// ============================================================================

/**
 * Hauptseite für das Scrum Board.
 * Wird als page-Slot in Paperclip registriert.
 */
export function ScrumBoardPage(_props: Partial<PluginPageProps> = {}) {
  return <ScrumBoardContainer />;
}

// ============================================================================
// Dashboard Widgets (manifest.ui.widgets)
// ============================================================================

/**
 * Sprint-Fortschritt: Story Points, Velocity und Burndown-Verhältnis.
 */
export function SprintProgressWidget() {
  const { state, loading } = useScrumBoard({ pollingIntervalMs: 15_000 });

  if (loading && !state) return <div className="widget widget-loading">Lade Sprint…</div>;
  if (!state) return <div className="widget widget-empty">Kein Sprint-Status verfügbar.</div>;

  const { metrics, currentSprint } = state;
  const total = metrics.totalPoints;
  const done = metrics.completedPoints;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="widget widget-sprint-progress">
      <h3>{currentSprint?.name ?? 'Kein aktiver Sprint'}</h3>
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Sprint-Fortschritt"
      >
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <p>
        {done} / {total} Story Points ({percent}%)
      </p>
      <p className="widget-meta">Velocity: {metrics.velocity}</p>
    </div>
  );
}

/**
 * Team-Status: welcher Agent woran arbeitet (Spec §5).
 */
export function TeamStatusWidget() {
  const { state, loading } = useScrumBoard({ pollingIntervalMs: 15_000 });

  if (loading && !state) return <div className="widget widget-loading">Lade Team…</div>;
  if (!state) return <div className="widget widget-empty">Kein Team-Status verfügbar.</div>;

  return (
    <div className="widget widget-team-status">
      <h3>Team</h3>
      <ul className="team-list">
        {state.agents.map((agent) => {
          const task = state.tasks.find((t) => t.id === agent.currentTaskId);
          return (
            <li key={agent.id} className={`team-member team-member-${agent.status}`}>
              <span className="team-member-name">{agent.name}</span>
              <span className="team-member-task">{task ? task.title : 'frei'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// Sidebar Link Component
// ============================================================================

/**
 * Sidebar-Link für das Scrum Board.
 * Wird als sidebar-Slot in Paperclip registriert.
 */
export function ScrumBoardSidebarLink({ context }: PluginPageProps) {
  const companyPrefix = context.companyPrefix || 'default';
  const href = `/${companyPrefix}/${PAGE_ROUTE}`;

  return (
    <a
      href={href}
      className="sidebar-link scrum-board-sidebar-link"
      title="Scrum Board"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        textDecoration: 'none',
        color: 'inherit',
        borderRadius: '4px',
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
      <span>Scrum Board</span>
    </a>
  );
}

// ============================================================================
// Settings Page Component
// ============================================================================

/**
 * Settings-Seite für das Scrum Board.
 * Wird als settingsPage-Slot in Paperclip registriert.
 */
export function ScrumBoardSettingsPage(_props: Partial<PluginPageProps> = {}) {
  const [settings, setSettings] = useState<PluginSettings>(() => loadSettingsFromStorage());

  const handleSettingsChange = useCallback((newSettings: PluginSettings) => {
    setSettings(newSettings);
    saveSettingsToStorage(newSettings);
  }, []);

  // Render settings inline (nicht als Modal)
  return (
    <div className="scrum-board-settings-page" style={{ padding: '24px' }}>
      <h1 style={{ marginBottom: '24px', fontSize: '24px', fontWeight: 700 }}>
        Scrum Board Settings
      </h1>
      <SettingsForm settings={settings} onSettingsChange={handleSettingsChange} />
    </div>
  );
}

// ============================================================================
// Inline Settings Form (für Settings Page ohne Modal)
// ============================================================================

interface SettingsFormProps {
  settings: PluginSettings;
  onSettingsChange: (settings: PluginSettings) => void;
}

function SettingsForm({ settings, onSettingsChange }: SettingsFormProps) {
  const [localSettings, setLocalSettings] = useState<PluginSettings>(settings);
  const [hasChanges, setHasChanges] = useState(false);

  const updateTeamSize = useCallback((developerCount: number) => {
    setLocalSettings((prev) => ({
      ...prev,
      teamSize: { ...prev.teamSize, developerCount },
    }));
    setHasChanges(true);
  }, []);

  const updateWipLimits = useCallback((key: string, value: number) => {
    setLocalSettings((prev) => ({
      ...prev,
      wipLimits: { ...prev.wipLimits, [key]: value },
    }));
    setHasChanges(true);
  }, []);

  const updateSprintLength = useCallback((lengthWeeks: number) => {
    setLocalSettings((prev) => ({
      ...prev,
      sprint: { ...prev.sprint, lengthWeeks },
    }));
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    onSettingsChange(localSettings);
    setHasChanges(false);
  }, [localSettings, onSettingsChange]);

  return (
    <div className="settings-form" style={{ display: 'grid', gap: '24px', maxWidth: '600px' }}>
      <section style={{ display: 'grid', gap: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600 }}>👥 Team-Größe</h3>
        <label style={{ display: 'grid', gap: '4px' }}>
          Anzahl Developer (1-5)
          <input
            type="number"
            min={1}
            max={5}
            value={localSettings.teamSize.developerCount}
            onChange={(e) => updateTeamSize(parseInt(e.target.value) || 1)}
            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </label>
      </section>

      <section style={{ display: 'grid', gap: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600 }}>📋 WIP-Limits</h3>
        {['todo', 'development', 'review'].map((key) => (
          <label key={key} style={{ display: 'grid', gap: '4px' }}>
            {key.charAt(0).toUpperCase() + key.slice(1)} Limit
            <input
              type="number"
              min={1}
              max={50}
              value={localSettings.wipLimits[key as keyof typeof localSettings.wipLimits]}
              onChange={(e) => updateWipLimits(key, parseInt(e.target.value) || 1)}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </label>
        ))}
      </section>

      <section style={{ display: 'grid', gap: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600 }}>🏃 Sprint-Konfiguration</h3>
        <label style={{ display: 'grid', gap: '4px' }}>
          Sprint-Länge (Wochen)
          <input
            type="number"
            min={1}
            max={4}
            value={localSettings.sprint.lengthWeeks}
            onChange={(e) => updateSprintLength(parseInt(e.target.value) || 2)}
            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </label>
      </section>

      <button
        onClick={handleSave}
        disabled={!hasChanges}
        style={{
          padding: '12px 24px',
          backgroundColor: hasChanges ? '#3b82f6' : '#9ca3af',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: hasChanges ? 'pointer' : 'not-allowed',
          fontWeight: 600,
        }}
      >
        💾 Speichern
      </button>
    </div>
  );
}
