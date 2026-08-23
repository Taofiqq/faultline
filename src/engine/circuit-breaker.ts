/**
 * Circuit Breaker — per-path state machine with generation tracking.
 *
 * States: closed → open → half-open → closed/open
 * Transitions based on consecutive caller-observed failures (timeouts + service errors).
 * Successes reset the counter. Generation prevents stale outcomes from corrupting state.
 */

export interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  openedAt: number | null; // simulated ms when circuit opened
  generation: number; // incremented on each open transition
  /** Sequence of the half-open probe request (first request after cooldown) */
  probeSequence: number | null;
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // consecutive failures to open
  cooldownMs: number; // time in open state before half-open
}

export function createCircuitBreakerState(): CircuitBreakerState {
  return {
    status: 'closed',
    consecutiveFailures: 0,
    openedAt: null,
    generation: 0,
    probeSequence: null,
  };
}

/**
 * Check if a request should be admitted.
 * Returns: 'admit' | 'probe' | 'reject'
 */
export function checkCircuit(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  currentTime: number,
  requestSequence: number,
): 'admit' | 'probe' | 'reject' {
  if (state.status === 'closed') {
    return 'admit';
  }

  if (state.status === 'open') {
    // Check if cooldown has elapsed
    if (state.openedAt !== null && currentTime >= state.openedAt + config.cooldownMs) {
      // Transition to half-open
      state.status = 'half-open';
      state.probeSequence = requestSequence;
      return 'probe';
    }
    return 'reject';
  }

  // half-open: only the probe request (first by sequence) is admitted
  if (state.probeSequence === requestSequence) {
    return 'probe';
  }
  return 'reject';
}

/**
 * Record a caller-observed outcome for circuit state update.
 * Only outcomes from the current generation are considered.
 */
export function recordOutcome(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  generation: number,
  success: boolean,
  currentTime: number,
): { stateChanged: boolean; newState?: CircuitBreakerState['status'] } {
  // Stale generation — ignore
  if (generation !== state.generation) {
    return { stateChanged: false };
  }

  if (success) {
    state.consecutiveFailures = 0;
    if (state.status === 'half-open') {
      // Probe succeeded — close circuit
      state.status = 'closed';
      state.probeSequence = null;
      return { stateChanged: true, newState: 'closed' };
    }
    return { stateChanged: false };
  }

  // Failure
  state.consecutiveFailures++;

  if (state.status === 'half-open') {
    // Probe failed — reopen with new generation and cooldown
    state.status = 'open';
    state.generation++;
    state.openedAt = currentTime;
    state.probeSequence = null;
    return { stateChanged: true, newState: 'open' };
  }

  if (state.status === 'closed' && state.consecutiveFailures >= config.failureThreshold) {
    // Threshold reached — open circuit
    state.status = 'open';
    state.generation++;
    state.openedAt = currentTime;
    return { stateChanged: true, newState: 'open' };
  }

  return { stateChanged: false };
}
