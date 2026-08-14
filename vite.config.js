import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must match the GitHub Pages repo name, or asset URLs 404 on deploy.
export default defineConfig({
  plugins: [react()],
  base: '/haydens-trainer/',
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
