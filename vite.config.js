import { defineConfig } from 'vite';



// base: './' keeps every asset path relative, so the build works from any
// GitHub Pages sub-path (https://<user>.github.io/<repo>/) and from file hosts.
export default defineConfig({
  base: './',
  server: { port: 5180, strictPort: true },
  preview: { port: 5181 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 3000,
  },
});