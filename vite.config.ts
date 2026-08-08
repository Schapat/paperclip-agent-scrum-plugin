import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Vite Konfiguration im Library-Mode für Paperclip Plugin.
 * 
 * Exportiert React-Komponenten als ES-Module statt als SPA.
 * Die Komponenten können von Paperclip direkt importiert werden.
 */
export default defineConfig({
  plugins: [react()],
  root: 'ui',
  base: './',
  build: {
    outDir: '../dist/ui',
    emptyDirOnBuildStart: true,
    // Library-Mode: ESM mit benannten Exports
    lib: {
      entry: resolve(__dirname, 'ui/exports.tsx'),
      name: 'ScrumTeamPlugin',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      // React als external markieren (wird von Paperclip bereitgestellt)
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@paperclipai/plugin-sdk',
        '@paperclipai/plugin-sdk/ui',
      ],
      output: {
        // Globals für UMD (für den Fall dass benötigt)
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
        // CSS in separate Datei
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'index.css';
          return assetInfo.name || 'asset';
        },
      },
    },
    // Source maps für Debugging
    sourcemap: true,
    // Minification für Production
    minify: 'esbuild',
    // Target für moderne Browser
    target: 'es2020',
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@worker': resolve(__dirname, 'worker'),
      '@ui': resolve(__dirname, 'ui'),
    },
  },
  server: {
    port: 3000,
    open: false,
  },
  // CSS Module Konfiguration
  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },
});
