import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// For GitHub Pages project sites, set base to '/REPO_NAME/' after you create the repo.
// For local dev or user/org root sites, '/' is correct.
export default defineConfig({
  plugins: [react()],
  base: './'
});
