import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// Folder the app reads its data from, served at /data/.
// Default (since S25, 2026-11-16): the real data built by the pipeline. Fake sample files: DATA_DIR=fixtures npm run dev
const dataDir = path.resolve(here, process.env.DATA_DIR ?? '../data/processed');

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.csv': 'text/csv; charset=utf-8',
};

function fireData(): Plugin {
  return {
    name: 'fire-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        const file = path.join(dataDir, rel);
        const inside = file.startsWith(dataDir + path.sep);
        if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      fs.cpSync(dataDir, path.resolve(here, 'dist/data'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './', // relative paths, so the built site works on GitHub Pages under any folder
  plugins: [fireData()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
