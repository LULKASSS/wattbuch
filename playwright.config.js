// Tests der App (Electron) mit simulierter Rolle. Ein Fenster nach dem anderen, die 3D-Szene braucht die Grafikkarte.
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'test', testMatch: /app\.spec\.js/, timeout: 90_000, workers: 1, reporter: process.env.CI ? 'github' : 'list' });
