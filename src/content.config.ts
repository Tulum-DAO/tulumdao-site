import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Written by scripts/sync-docs.mjs from Tulum-DAO/orchestraos at the sha in docs.lock.json.
// Never edit these files by hand: `npm run build` refuses if they differ from the lock.
const docs = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    source: z.string(),
    order: z.number(),
  }),
});

export const collections = { docs };
