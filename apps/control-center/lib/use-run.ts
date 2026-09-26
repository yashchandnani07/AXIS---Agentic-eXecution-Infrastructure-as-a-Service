/**
 * @file      apps/control-center/lib/use-run.ts
 * @phase     P11
 * @owner     Product & Experience
 * @purpose   React hook: loads a RunAggregate and keeps it fresh (SSE-triggered refetch, debounced; 10 s poll fallback).
 * @depends   react, ./api
 * @usedBy    app/run/page.tsx
 * @agentNotes Refetching the whole aggregate is intentional (simple + always consistent).
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { RunAggregate } from '@bobops/core';
import { MODE, api, subscribeEvents } from './api';
import { errorText } from './format';

export function useRun(runId: string | null) {
  const [data, setData] = useState<RunAggregate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!runId) return;
    try {
      setData(await api.getRun(runId));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [runId]);

  useEffect(() => {
    void refresh();
    if (!runId || MODE === 'replay') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeEvents((event) => {
      if (event.runId !== runId) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    });
    const poll = setInterval(() => void refresh(), 10_000);
    return () => {
      unsubscribe();
      clearInterval(poll);
      clearTimeout(timer);
    };
  }, [runId, refresh]);

  return { data, error, refresh };
}
