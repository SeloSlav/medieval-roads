import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      'sky-cloud-3d/webgl': fileURLToPath(new URL('./vendor/sky-cloud-3d/SkyCloudMesh.webgl', import.meta.url)),
      'sky-cloud-3d': fileURLToPath(new URL('./vendor/sky-cloud-3d/SkyCloudMesh.js', import.meta.url)),
    },
  },
});
