// Starts a production server for end-to-end tests with a fresh, throwaway
// data directory inside .test-tmp/ — never the real data/ folder.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const [port, name] = process.argv.slice(2);
const dataDir = resolve(import.meta.dirname, '..', '.test-tmp', `e2e-${name}`);
rmSync(dataDir, { recursive: true, force: true });
const child = spawn(
  process.execPath,
  ['--import', 'tsx', '--disable-warning=ExperimentalWarning', resolve(import.meta.dirname, '..', 'src/server/main.ts')],
  { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production', PORT: port, COOKBOOK_DATA_DIR: dataDir } },
);
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
