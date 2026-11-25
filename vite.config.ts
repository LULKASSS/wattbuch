import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/* Zwei Seiten: die sichtbare Bühne (3D, Anzeige) und der unsichtbare Maschinenraum (Bluetooth, Fahrt, Aufnahme).
   Alles landet in bau/ und wird von der App über app://wattbuch-neu/ geladen, nichts kommt aus dem Netz. */
export default defineConfig({
  base: './',
  build: {
    outDir: 'bau', emptyOutDir: true, target: 'chrome130', chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { buehne: resolve(__dirname, 'buehne.html'), maschine: resolve(__dirname, 'maschine.html') } }
  },
  test: { include: ['test/kern/**/*.test.ts'] }
} as any);
