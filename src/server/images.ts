import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMAGE_PATH_PATTERN } from '../shared/schema';
import { AppError } from './errors';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SIGNATURES: Array<{ ext: 'png' | 'jpg' | 'webp'; mime: string; test: (b: Buffer) => boolean }> = [
  { ext: 'png', mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/**
 * Stores an uploaded photo in `<dataDir>/uploads/` under a random name. The
 * file type is checked from its contents (not the filename), so only real
 * PNG/JPEG/WebP images are accepted. Returns the relative image path.
 */
export function saveImage(dataDir: string, bytes: Buffer): string {
  if (bytes.length === 0) throw new AppError(400, 'The image file is empty.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError(413, 'Images must be 5 MB or smaller.');
  const kind = SIGNATURES.find((s) => s.test(bytes));
  if (!kind) throw new AppError(415, 'Only PNG, JPEG or WebP images are supported.');
  const dir = join(dataDir, 'uploads');
  mkdirSync(dir, { recursive: true });
  const rel = `uploads/${randomBytes(16).toString('hex')}.${kind.ext}`;
  writeFileSync(join(dataDir, rel), bytes, { flag: 'wx' });
  return rel;
}

/** Resolves a stored image path safely, or null if it is not a valid upload path. */
export function resolveImage(dataDir: string, rel: string): { file: string; mime: string } | null {
  if (!IMAGE_PATH_PATTERN.test(rel)) return null;
  const ext = rel.slice(rel.lastIndexOf('.') + 1);
  const mime = SIGNATURES.find((s) => s.ext === ext)!.mime;
  return { file: join(dataDir, rel), mime };
}
