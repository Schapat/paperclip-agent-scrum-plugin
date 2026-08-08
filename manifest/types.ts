/**
 * Plugin Manifest Type Definitions
 *
 * TypeScript-Definitionen für das Paperclip Plugin-Manifest-Schema.
 */

// =============================================================================
// Config Field Types
// =============================================================================

export interface ConfigFieldBase {
  label: string;
  description: string;
  required?: boolean;
  dependsOn?: Record<string, unknown>;
}

export interface NumberConfigField extends ConfigFieldBase {
  type: 'number';
  default: number;
  min?: number;
  max?: number;
}

export interface BooleanConfigField extends ConfigFieldBase {
  type: 'boolean';
  default: boolean;
}

export interface StringConfigField extends ConfigFieldBase {
  type: 'string';
  default: string;
  pattern?: string;
}

export interface SelectConfigField extends ConfigFieldBase {
  type: 'select';
  default: string | number;
  options: (string | number)[];
}

export type ConfigField =
  | NumberConfigField
  | BooleanConfigField
  | StringConfigField
  | SelectConfigField;

// =============================================================================
// UI Slot Types
// =============================================================================

export interface UIPage {
  slug: string;
  title: string;
  description: string;
  component: string;
  icon?: string;
}

export interface UIWidget {
  slug: string;
  title: string;
  description: string;
  component: string;
  size: {
    minWidth: number;
    minHeight: number;
    maxWidth?: number;
    maxHeight?: number;
  };
}

export interface UIConfig {
  pages: UIPage[];
  widgets?: UIWidget[];
}

// =============================================================================
// Agent Template Types
// =============================================================================

export interface AgentTemplate {
  name: string;
  role: string;
  icon: string;
  title: string;
  capabilities: string[];
  instructionsFile: string;
  instanceTemplate?: boolean;
}

// =============================================================================
// Ceremony Types
// =============================================================================

/**
 * Deklaration einer Scrum-Zeremonie.
 *
 * Bewusst ohne `schedule`: Zeremonien hängen an Bedingungen über dem
 * Board-Zustand, nicht an Uhrzeiten (Spec §2, §4). Die in `triggers`
 * genannten IDs entsprechen den Bedingungen in
 * `worker/triggers/ceremony-triggers.ts`.
 */
export interface CeremonyTemplate {
  name: string;
  description: string;
  /** Interner Zeremonie-Typ, z.B. 'sprint_planning' */
  ceremony: string;
  /** Benannter Export aus dem Handler-Modul */
  handler: string;
  /** Config-Schlüssel, der den automatischen Trigger ein-/ausschaltet */
  enabledConfigKey?: string;
  /** IDs der auslösenden Bedingungen */
  triggers: string[];
  /** Was die Zeremonie erzeugt — ohne Output hat sie keine Existenzberechtigung */
  outputs?: string[];
}

// =============================================================================
// Worker Config Types
// =============================================================================

export interface WorkerConfig {
  entry: string;
  events: string[];
}

// =============================================================================
// Main Manifest Type
// =============================================================================

/**
 * Paperclip Plugin Manifest Schema
 *
 * Definiert alle Metadaten, Capabilities und Konfigurationsoptionen
 * für ein Paperclip Plugin.
 */
export interface PluginManifest {
  // Identifikation
  name: string;
  version: string;
  description: string;
  author: string;

  // Berechtigungen
  capabilities: PaperclipCapability[];

  // UI Registrierungen
  ui: UIConfig;

  // Konfigurierbare Einstellungen
  config: Record<string, ConfigField>;

  // Worker
  worker: WorkerConfig;

  // Agent Templates
  agentTemplates?: Record<string, AgentTemplate>;

  // Routine Templates
  ceremonyHandlerModule?: string;
  ceremonies?: Record<string, CeremonyTemplate>;

  // Externe Dependencies
  requiredSecrets?: string[];

  // Kompatibilität
  compatibility?: {
    minPaperclipVersion?: string;
  };
}

// =============================================================================
// Capability Types
// =============================================================================

/**
 * Alle verfügbaren Paperclip Capabilities
 */
export type PaperclipCapability =
  // Agent Management
  | 'agents:create'
  | 'agents:configure'
  | 'agents:read'
  | 'agents:delete'
  // Issue Management
  | 'issues:read'
  | 'issues:write'
  | 'issues:comment'
  | 'issues:delete'
  // Routine Management
  | 'routines:create'
  | 'routines:configure'
  | 'routines:trigger'
  | 'routines:delete'
  // Project Management
  | 'projects:read'
  | 'projects:write'
  // Storage
  | 'storage:read'
  | 'storage:write'
  // Secrets
  | 'secrets:read';

// =============================================================================
// Resolved Config Types (nach User-Eingabe)
// =============================================================================

/**
 * Resolved Plugin-Konfiguration (alle Config-Felder mit tatsächlichen Werten)
 */
export interface ResolvedPluginConfig {
  developerCount: number;
  wipLimit: number;
  sprintDurationDays: number;
  enableAutoPlanning: boolean;
  enableAutoRefinement: boolean;
  enableAutoImpediments: boolean;
  enableAutoReview: boolean;
  autoAssignTasks: boolean;
  autoCreateSubtasks: boolean;
  useStoryPoints: boolean;
  defaultStoryPoints: number;
}

// =============================================================================
// Export manifest type for import
// =============================================================================

declare const manifest: PluginManifest;
export default manifest;
