import type { z } from 'zod';
import { describeZodError } from '../shared/schema';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: string[] = [],
    public readonly code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, `${what} not found.`);

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, `Please check the ${what}.`, describeZodError(result.error), 'validation');
  }
  return result.data;
}
