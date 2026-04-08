import { z } from 'zod';

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = CreateProjectInput.partial();
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

// ProjectStatsQuery / StatsScope live in schemas/stats.ts
