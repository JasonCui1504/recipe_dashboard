import { z } from 'zod';
import { mealSchema, pantryItemSchema, recipeSchema, shoppingItemSchema, storeSchema } from './schema';

export const BACKUP_FORMAT = 'the-cookbook-backup';
export const BACKUP_VERSION = 1;

/**
 * Backup file format (version 1):
 * {
 *   "format": "the-cookbook-backup",
 *   "version": 1,
 *   "exportedAt": "2026-01-01T12:00:00.000Z",
 *   "data": { "recipes": [...], "pantry": [...], "mealPlan": [...], "shopping": [...], "stores": [...] }
 * }
 * Uploaded recipe photos are referenced by path but not embedded.
 */
export const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  data: z.object({
    recipes: z.array(recipeSchema).max(5000),
    pantry: z.array(pantryItemSchema).max(5000).default([]),
    mealPlan: z.array(mealSchema).max(20000).default([]),
    shopping: z.array(shoppingItemSchema).max(5000).default([]),
    stores: z.array(storeSchema).max(200).default([]),
  }),
});
export type Backup = z.infer<typeof backupSchema>;

/**
 * What to do with records whose ID already exists:
 *  - "skip": keep what you have (default, never overwrites);
 *  - "replace": overwrite with the backup's version;
 *  - "copy": import the backup's version as a new record with a new ID.
 */
export const CONFLICT_STRATEGIES = ['skip', 'replace', 'copy'] as const;
export type ConflictStrategy = (typeof CONFLICT_STRATEGIES)[number];

export interface ImportPreview {
  exportedAt: string;
  sections: Array<{
    key: keyof Backup['data'];
    label: string;
    total: number;
    new: number;
    identical: number;
    conflicts: Array<{ id: string; incoming: string; existing: string }>;
  }>;
}

export interface ImportResult {
  added: number;
  replaced: number;
  copied: number;
  skipped: number;
  warnings: string[];
}

/** Version check first, so an old/new file gets a clear message instead of a schema dump. */
export function checkBackupHeader(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'This file is not a Cookbook backup (expected a JSON object).';
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== BACKUP_FORMAT) {
    return 'This file is not a Cookbook backup (missing "format": "the-cookbook-backup").';
  }
  if (typeof obj.version !== 'number') return 'The backup has no format version.';
  if (obj.version > BACKUP_VERSION) {
    return `This backup was made by a newer version of the app (format v${obj.version}); this app reads up to v${BACKUP_VERSION}.`;
  }
  if (obj.version < 1) return `Unsupported backup version ${obj.version}.`;
  return null;
}
