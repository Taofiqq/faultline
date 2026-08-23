// ─── Failure Injection Types ─────────────────────────────────────────────────

export interface FixedLatencyInjection {
  type: 'fixedLatency';
  ms: number; // ≥ 0
  probability: number; // [0, 1]
}

export interface RandomLatencyInjection {
  type: 'randomLatency';
  minMs: number; // ≥ 0
  maxMs: number; // ≥ minMs
  probability: number; // [0, 1]
}

export interface LostResponseInjection {
  type: 'lostResponse';
  probability: number; // [0, 1]
}

export interface ServiceErrorInjection {
  type: 'serviceError';
  probability: number; // [0, 1]
}

export interface DuplicateRequestInjection {
  type: 'duplicateRequest';
  count: number; // ≥ 2
  probability: number; // [0, 1]
}

export type FailureInjection =
  | FixedLatencyInjection
  | RandomLatencyInjection
  | LostResponseInjection
  | ServiceErrorInjection
  | DuplicateRequestInjection;

// ─── Resilience Pattern Types ────────────────────────────────────────────────

export interface RetryConfig {
  maxRetries: number; // [0, 50]
  baseDelay: number; // ms, > 0
  jitterFactor: number; // [0, 1]
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // ≥ 1
  cooldownMs: number; // > 0
}

export interface ResilienceConfig {
  idempotencyEnabled: boolean;
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
}

// ─── Service & Path ──────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
}

export interface Path {
  id: string;
  source: string; // service ID
  destination: string; // service ID, ≠ source
  label: string;
  deadlineMs: number; // > 0
  operationName: string;
  sideEffect?: string; // optional named side-effect
  failures: FailureInjection[];
  resilience: ResilienceConfig;
}

// ─── Invariant Types ─────────────────────────────────────────────────────────

export interface MaxSideEffectCountInvariant {
  type: 'maxSideEffectCount';
  id: string;
  effectName: string;
  maxCount: number; // ≥ 0
}

export interface MaxRequestCountInvariant {
  type: 'maxRequestCount';
  id: string;
  pathId: string;
  maxCount: number; // ≥ 0
}

export interface RequiredSuccessCountInvariant {
  type: 'requiredSuccessCount';
  id: string;
  pathId: string;
  minCount: number; // ≥ 0
}

export interface MaxCompletionTimeInvariant {
  type: 'maxCompletionTime';
  id: string;
  maxMs: number; // > 0
}

export interface NoPendingRequestsInvariant {
  type: 'noPendingRequests';
  id: string;
}

export type Invariant =
  | MaxSideEffectCountInvariant
  | MaxRequestCountInvariant
  | RequiredSuccessCountInvariant
  | MaxCompletionTimeInvariant
  | NoPendingRequestsInvariant;

// ─── Scenario (validated, engine-ready) ──────────────────────────────────────

export interface Scenario {
  schemaVersion: 1;
  seed: number; // u32: [0, 4294967295]
  maxSimulationTimeMs: number; // > 0, default 60000
  services: Service[];
  paths: Path[];
  invariants: Invariant[];
}

// ─── ScenarioDraft (UI editing state, may be invalid) ────────────────────────

export interface ServiceDraft {
  id: string;
  name: string;
}

export interface PathDraft {
  id: string;
  source: string;
  destination: string;
  label: string;
  deadlineMs: number | null;
  operationName: string;
  sideEffect?: string;
  failures: FailureInjection[];
  resilience: Partial<ResilienceConfig>;
}

export interface InvariantDraft {
  type: Invariant['type'];
  id: string;
  [key: string]: unknown;
}

export interface ScenarioDraft {
  services: ServiceDraft[];
  paths: PathDraft[];
  invariants: InvariantDraft[];
  seed: number | null;
  maxSimulationTimeMs: number | null;
}

// ─── Validation Error ────────────────────────────────────────────────────────

export interface ValidationError {
  path: string; // JSON pointer to invalid field
  code: string; // machine-readable error code
  message: string; // human-readable explanation
  actual?: unknown;
  expected?: unknown;
}

// ─── Validation Result ───────────────────────────────────────────────────────

export type ValidationResult =
  { valid: true; scenario: Scenario } | { valid: false; errors: ValidationError[] };
