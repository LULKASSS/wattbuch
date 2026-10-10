// Browsertests mit der simulierten Rolle. Nutzt das installierte Chrome,
// es wird kein extra Browser heruntergeladen.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'test',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    channel: process.env.CI ? undefined : 'chrome',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin'
  },
  projects: [
    { name: 'mac', use: { viewport: { width: 1280, height: 860 } }, testIgnore: /desktop/ },
    { name: 'app', testMatch: /desktop\.spec/ },
    { name: 'iphone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' }, grep: /@mobil/, testIgnore: /desktop/ }
  ],
  webServer: { command: 'node scripts/serve.mjs', env: { PORT: '5174' }, url: 'http://localhost:5174', reuseExistingServer: !process.env.CI }
});
