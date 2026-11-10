// Settings for scripts/browser-test.mjs (node --test driving this machine's Chrome over DevTools).
export default {
  testDir: './tests',
  timeout: 240000,
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:5180',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { viewport: { width: 1280, height: 720 } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5180',
    reuseExistingServer: true,
    timeout: 60000,
  },
};
