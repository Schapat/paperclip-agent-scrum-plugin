/**
 * Header Component
 *
 * Zeigt Sprint-Informationen und Navigation.
 * Enthält Button zum Öffnen der Einstellungen.
 */

import type { ScrumSprint } from '@shared/types';

interface HeaderProps {
  currentSprint: ScrumSprint | null;
  onSettingsClick: () => void;
}

export function Header({ currentSprint, onSettingsClick }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="logo">🚀 Scrum Board</h1>
      </div>

      <div className="header-center">
        {currentSprint ? (
          <div className="sprint-info">
            <span className="sprint-name">{currentSprint.name}</span>
            <span className="sprint-status">{currentSprint.status}</span>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={() => {}}>
            + Neuen Sprint starten
          </button>
        )}
      </div>

      <div className="header-right">
        <button className="btn btn-icon" title="Einstellungen" onClick={onSettingsClick}>
          ⚙️
        </button>
      </div>
    </header>
  );
}
