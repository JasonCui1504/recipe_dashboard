// Runs the API server and the Vite dev server together (both on 127.0.0.1).
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npm, ['run', 'dev:server'], { stdio: 'inherit' }),
  spawn(npm, ['run', 'dev:client'], { stdio: 'inherit' }),
];
const stop = () => children.forEach((c) => c.kill('SIGTERM'));
for (const child of children) child.on('exit', (code) => { stop(); process.exitCode = code ?? 0; });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
