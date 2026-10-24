import type { Entry } from './domain.ts';

export const sortedEntries = (entries: Entry[]): Entry[] => [...entries].sort((a, b) =>
  b.date.localeCompare(a.date) ||
  (b.createdAt || '').localeCompare(a.createdAt || '') ||
  b.id.localeCompare(a.id));
