import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: { port: 5173, host: true },
  build: { target: 'es2022', sourcemap: true, outDir: 'dist/app' },
  worker: { format: 'es' },
});
