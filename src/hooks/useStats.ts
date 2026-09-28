/**
 * @fileoverview src/hooks/useStats.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { useState, useEffect } from 'react';
import { ReviewLogStore } from '../lib/db/store';

export interface StatsData {
  totalReviews: number;
  retentionRate: number;
  last7Days: { date: string; count: number }[];
  knobDistribution: { range: string; count: number }[];
}

export function useStats() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    async function loadStats() {
      try {
        setLoading(true);
        setError(null);
        setStats(await ReviewLogStore.getStats());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Learning statistics could not be loaded.');
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [attempt]);

  return { stats, loading, error, retry: () => setAttempt(current => current + 1) };
}
