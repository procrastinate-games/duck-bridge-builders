import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    "name": "duck-bridge-builders",
    "compatibilityDate": "2026-11-04",
    "observability": {
      "enabled": true
    },
    "assets": {
      "notFoundHandling": "single-page-application"
    }
  }
});
