import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

/**
 * Starts the local server. It always binds to 127.0.0.1, so the cookbook is
 * reachable only from this computer.
 *
 *   npm run dev   → API on 127.0.0.1:5174 (Vite serves the UI on :5173)
 *   npm start     → UI + API on 127.0.0.1:4173 from the production build
 */
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? (production ? 4173 : 5174));
const dataDir = resolve(projectRoot, process.env.COOKBOOK_DATA_DIR ?? 'data');
const staticDir = resolve(projectRoot, 'dist');

if (production && !existsSync(resolve(staticDir, 'index.html'))) {
  console.error('No production build found. Run "npm run build" first.');
  process.exit(1);
}

const app = createApp({ dataDir, staticDir: production ? staticDir : undefined });
app.server.listen(port, '127.0.0.1', () => {
  console.log(`The Cookbook ${production ? '' : 'API '}is running at http://127.0.0.1:${port}`);
  console.log(`Data directory: ${dataDir}`);
});

const shutdown = () => {
  app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
