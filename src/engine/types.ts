// ─── Simulation Event Types ──────────────────────────────────────────────────
// 11 event types forming the normalized event sequence.
// Sorted by (timestamp, sequence) for determinism verification.

export interface RequestSentEvent {
  type: 'RequestSent';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  idempotencyKey: string;
  attempt: number;
  deliveryIndex: number;
}

export interface RequestArrivedEvent {
  type: 'RequestArrived';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  idempotencyKey: string;
  attempt: number;
  deliveryIndex: number;
  deduplicated: boolean;
}

export interface SideEffectEvent {
  type: 'SideEffect';
  timestamp: number;
  sequence: number;
  serviceId: string;
  effectName: string;
  operationId: number;
}

export interface ResponseSentEvent {
  type: 'ResponseSent';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  success: boolean;
  deduplicated: boolean;
}

export interface ResponseReceivedEvent {
  type: 'ResponseReceived';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  success: boolean;
  deduplicated: boolean;
  late: boolean;
  latency: number;
}

export interface ResponseLostEvent {
  type: 'ResponseLost';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
}

export interface TimeoutErrorEvent {
  type: 'TimeoutError';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  attempt: number;
}

export interface CircuitOpenErrorEvent {
  type: 'CircuitOpenError';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
}

export interface CircuitStateChangeEvent {
  type: 'CircuitStateChange';
  timestamp: number;
  sequence: number;
  pathId: string;
  newState: 'open' | 'half-open' | 'closed';
  generation: number;
}

export interface RetryScheduledEvent {
  type: 'RetryScheduled';
  timestamp: number;
  sequence: number;
  pathId: string;
  operationId: number;
  nextAttempt: number;
  delay: number;
}

export interface SimulationStoppedEvent {
  type: 'SimulationStopped';
  timestamp: number;
  sequence: number;
  reason: 'time-limit' | 'event-limit';
}

export type SimEvent =
  | RequestSentEvent
  | RequestArrivedEvent
  | SideEffectEvent
  | ResponseSentEvent
  | ResponseReceivedEvent
  | ResponseLostEvent
  | TimeoutErrorEvent
  | CircuitOpenErrorEvent
  | CircuitStateChangeEvent
  | RetryScheduledEvent
  | SimulationStoppedEvent;

// ─── Event Log ───────────────────────────────────────────────────────────────

export type EventLog = SimEvent[];

// ─── Simulation Result ───────────────────────────────────────────────────────

export interface SimulationResult {
  events: EventLog;
  finalTimestamp: number;
  totalEvents: number;
  stopped: boolean;
  stopReason?: 'time-limit' | 'event-limit';
}
