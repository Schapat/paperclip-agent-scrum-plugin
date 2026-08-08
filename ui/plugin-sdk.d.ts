/**
 * Paperclip Plugin SDK Type Declarations
 *
 * Typen für die Paperclip Plugin SDK Integration.
 * Diese werden benötigt, da wir das SDK als external markieren.
 */

declare module '@paperclipai/plugin-sdk/ui' {
  /**
   * Context der an Plugin-Komponenten übergeben wird.
   */
  export interface PluginContext {
    /** Company ID wenn verfügbar */
    companyId?: string | null;
    /** Company URL-Prefix für Links */
    companyPrefix?: string;
    /** Plugin ID */
    pluginId?: string;
    /** Plugin Version */
    pluginVersion?: string;
    /** Aktueller User */
    userId?: string | null;
    /** Aktuelle Route */
    route?: string;
  }

  /**
   * Hook für Host Context.
   */
  export function useHostContext(): {
    companyId: string | null;
    companyPrefix: string;
    navigate: (path: string) => void;
  };

  /**
   * Hook für Plugin-spezifische Daten.
   */
  export function usePluginData<T>(
    key: string,
    params?: Record<string, unknown>
  ): {
    data: T | null;
    loading: boolean;
    error: Error | null;
    refresh: () => void;
  };
}
