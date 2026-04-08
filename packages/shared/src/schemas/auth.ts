import { z } from 'zod';

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const SessionUser = z.object({
  id: z.string(),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'USER']),
});
export type SessionUser = z.infer<typeof SessionUser>;
