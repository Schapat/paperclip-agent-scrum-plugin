/**
 * Build Manifest Script
 *
 * Verarbeitet das Manifest und kopiert es in den dist Ordner.
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'manifest', 'manifest.js');
const distPath = path.join(__dirname, '..', 'dist');
const outputPath = path.join(distPath, 'manifest.json');

// Dist Ordner erstellen falls nicht vorhanden
if (!fs.existsSync(distPath)) {
  fs.mkdirSync(distPath, { recursive: true });
}

// Manifest laden und verarbeiten
const manifest = require(manifestPath);

// Als JSON speichern
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

console.log('✅ Manifest built successfully:', outputPath);
