import { z } from 'zod';
import { LIMITS } from '../constants';
import { isValidDonorUrl } from '../url';

const ManualLinkItem = z.object({
  donorUrl: z.string().refine(isValidDonorUrl, {
    message: 'donorUrl must be a valid http(s) URL',
  }),
  acceptor: z.string().min(1).max(2048),
});
export type ManualLinkItem = z.infer<typeof ManualLinkItem>;

export const CreateManualLinksInput = z.object({
  items: z
    .array(ManualLinkItem)
    .min(1)
    .max(LIMITS.MAX_MANUAL_URLS_PER_TASK, {
      message: `Cannot add more than ${LIMITS.MAX_MANUAL_URLS_PER_TASK} links per request`,
    }),
});
export type CreateManualLinksInput = z.infer<typeof CreateManualLinksInput>;

export const ListLinksQuery = z.object({
  source: z.enum(['manual', 'sheets']).optional(),
  status: z.enum(['PENDING', 'QUEUED', 'CHECKING', 'DONE', 'ERROR']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  // Aligned with MAX_MANUAL_URLS_PER_TASK so the UI can fetch a full
  // manual project in one shot. Pagination kicks in only beyond that.
  limit: z.coerce.number().int().min(1).max(LIMITS.MAX_MANUAL_URLS_PER_TASK).default(100),
});
export type ListLinksQuery = z.infer<typeof ListLinksQuery>;

/**
 * Shape stored in Link.occurrences (JSON column).
 */
export const LinkOccurrence = z.object({
  href: z.string(),
  anchor: z.string(),
  rel: z.array(z.string()),
  target: z.string().nullable(),
  tag: z.string(), // 'a' | 'link' | 'area' | 'data-href' | ...
  position: z.number().int(),
});
export type LinkOccurrence = z.infer<typeof LinkOccurrence>;
