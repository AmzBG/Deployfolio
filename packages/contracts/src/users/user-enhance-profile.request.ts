import { z } from 'zod';

export const enhanceProfileRequestSchema = z.object({
  headline: z.string().max(160),
  bio: z.string().max(5000),
});

export type EnhanceProfileRequest = z.infer<typeof enhanceProfileRequestSchema>;
