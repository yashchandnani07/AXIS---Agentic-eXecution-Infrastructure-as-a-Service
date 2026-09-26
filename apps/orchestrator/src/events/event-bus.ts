/**
 * @file      apps/orchestrator/src/events/event-bus.ts
 * @phase     P4
 * @owner     Orchestration & Cloud
 * @purpose   Creates auditable RunEvents (persisted) and fans them out to live subscribers (SSE → Control Center).
 * @depends   @bobops/core, ../store/json-store
 * @usedBy    RunService, LifecycleService, routes/events.ts
 * @agentNotes Every state-changing step must emit at least one event with the right actor + kind (PRD §6 evidence standard).
 */
import { newId, nowIso, type Actor, type EventKind, type EventType, type Evidence, type RunEvent } from '@bobops/core';
import type { JsonStore } from '../store/json-store';

export interface EmitInput {
  runId: string;
  actor: Actor;
  kind: EventKind;
  type: EventType;
  message: string;
  evidence?: Evidence[];
}

type Listener = (event: RunEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();

  constructor(private readonly store: JsonStore) {}

  emit(input: EmitInput): RunEvent {
    const event: RunEvent = {
      id: newId('evt'),
      at: nowIso(),
      runId: input.runId,
      actor: input.actor,
      kind: input.kind,
      type: input.type,
      message: input.message,
      evidence: input.evidence ?? [],
    };
    this.store.data.events.push(event);
    this.store.persist();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[event-bus] listener failed', err);
      }
    }
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
