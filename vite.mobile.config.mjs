import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve('mobile'),
  publicDir: resolve('public'),
  envDir: resolve('.'),
  resolve: { alias: { '/src': resolve('src') } },
  server: { fs: { allow: [resolve('.')] } },
  plugins: [{ name: 'mobile-source', configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.startsWith('/src/')) request.url = `/@fs${resolve('.')}${request.url}`;
      next();
    });
  } }],
  build: { outDir: resolve('dist-mobile'), emptyOutDir: true,
    rollupOptions: { input: resolve('mobile/index.html'), output: {
      manualChunks: id => id.includes('/node_modules/@supabase/') ? 'supabase' : undefined,
    } } },
});
