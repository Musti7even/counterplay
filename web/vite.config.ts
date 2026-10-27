import { defineConfig } from 'vite';
import { resolve, relative } from 'node:path';
import { createReadStream, existsSync, readdirSync, cpSync, mkdirSync } from 'node:fs';

// ../data is served at /data/* in dev + preview, and copied into dist/data on build (self-contained static site).
const dataDir = resolve(import.meta.dirname, '../data');
const serveData = (server: { middlewares: { use: Function } }) => {
  server.middlewares.use('/data', (req: any, res: any, next: any) => {
    const file = resolve(dataDir, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(dataDir) || !existsSync(file)) return next();
    res.setHeader('Content-Type', file.endsWith('.mp3') ? 'audio/mpeg' : 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(file).pipe(res);
  });
};

export default defineConfig({
  base: './', // relative asset URLs: works at a domain root or any subpath (GitHub Pages, Azure Static Web Apps)
  plugins: [{
    name: 'serve-data', configureServer: serveData, configurePreviewServer: serveData,
    // ponytail: copies every *.json (minus dev mocks / engine checkpoints) + audio/; ~5 MB today, filter by run if it grows
    writeBundle(opts) {
      const out = resolve(opts.dir ?? 'dist', 'data');
      mkdirSync(out, { recursive: true });
      for (const f of readdirSync(dataDir)) if (f.endsWith('.json') && !/mock/.test(f)) cpSync(resolve(dataDir, f), resolve(out, f));
      if (existsSync(resolve(dataDir, 'audio'))) cpSync(resolve(dataDir, 'audio'), resolve(out, 'audio'), { recursive: true });
      console.log(`copied data -> ${relative(process.cwd(), out)}`);
    },
  }],
  server: { port: 5173 },
});
