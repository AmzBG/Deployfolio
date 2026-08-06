import { z } from 'zod';

export const enhanceProfileResponseSchema = z.object({
  headline: z.string(),
  bio: z.string(),
});

export type EnhanceProfileResponse = z.infer<
  typeof enhanceProfileResponseSchema
>;
