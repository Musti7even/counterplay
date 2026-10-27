import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { createReadStream, existsSync } from 'node:fs';

// Serve ../data at /data/* in dev + preview without copying it.
const dataDir = resolve(import.meta.dirname, '../data');
const serveData = (server: { middlewares: { use: Function } }) => {
  server.middlewares.use('/data', (req: any, res: any, next: any) => {
    const file = resolve(dataDir, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(dataDir) || !existsSync(file)) return next();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(file).pipe(res);
  });
};

export default defineConfig({
  plugins: [{ name: 'serve-data', configureServer: serveData, configurePreviewServer: serveData }],
  server: { port: 5173 },
});
