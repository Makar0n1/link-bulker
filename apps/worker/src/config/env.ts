import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().min(1),
  FIRECRAWL_API_KEY: z.string().min(1).optional(),
  FIRECRAWL_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(45),
  PER_DOMAIN_RPS: z.coerce.number().int().min(1).max(100).default(2),

  // Google Sheets — both forms accepted, file path takes precedence.
  // GOOGLE_SERVICE_ACCOUNT_PATH: absolute or relative path to a JSON key file.
  // GOOGLE_SERVICE_ACCOUNT_JSON: the JSON itself, inline (useful for envs
  //   where mounting a file is awkward; e.g. Vercel-style hosting).
  // GOOGLE_SERVICE_ACCOUNT_EMAIL: optional override; if not set we read it
  //   from the loaded credentials.
  GOOGLE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

let cached: WorkerEnv | null = null;

export function loadEnv(): WorkerEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('[worker env] invalid:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid worker environment configuration');
  }
  cached = parsed.data;
  return cached;
}
