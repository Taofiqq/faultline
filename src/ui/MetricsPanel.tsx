import type { SimulationMetrics } from '../metrics/compute';

interface MetricsPanelProps {
  metrics: SimulationMetrics;
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  return (
    <div className="metrics-panel" aria-label="Simulation metrics">
      <div className="metrics-grid">
        <MetricCard label="Requests" value={metrics.totalRequests} />
        <MetricCard label="Attempts" value={metrics.totalAttempts} />
        <MetricCard label="Deliveries" value={metrics.totalDeliveries} />
        <MetricCard label="Retries" value={metrics.retries} />
        <MetricCard label="Successful Outcomes" value={metrics.successfulCallerOutcomes} />
        <MetricCard label="Duplicate Deliveries" value={metrics.duplicateDeliveries} />
        <MetricCard label="Deduplications" value={metrics.deduplications} />
        <MetricCard label="Circuit Transitions" value={metrics.circuitTransitions} />
        <MetricCard label="Duration" value={`${metrics.simulatedDuration} ms`} />
        <MetricCard label="Total Events" value={metrics.totalEvents} />
      </div>

      <h4 className="panel-subheading">Failures</h4>
      <div className="metrics-grid">
        <MetricCard label="Timeouts" value={metrics.failuresByType.timeout} />
        <MetricCard label="Service Errors" value={metrics.failuresByType.serviceError} />
        <MetricCard label="Circuit Open" value={metrics.failuresByType.circuitOpen} />
        <MetricCard label="Response Lost" value={metrics.failuresByType.responseLost} />
      </div>

      <h4 className="panel-subheading">Latency Percentiles (simulated ms)</h4>
      <div className="metrics-grid">
        <MetricCard
          label="p50"
          value={metrics.p50Latency !== null ? `${metrics.p50Latency} ms` : 'No eligible responses'}
        />
        <MetricCard
          label="p95"
          value={metrics.p95Latency !== null ? `${metrics.p95Latency} ms` : 'No eligible responses'}
        />
        <MetricCard
          label="p99"
          value={metrics.p99Latency !== null ? `${metrics.p99Latency} ms` : 'No eligible responses'}
        />
      </div>

      {Object.keys(metrics.sideEffectCounts).length > 0 && (
        <>
          <h4 className="panel-subheading">Side Effects</h4>
          <div className="metrics-grid">
            {Object.entries(metrics.sideEffectCounts).map(([name, count]) => (
              <MetricCard key={name} label={name} value={count} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span className="metric-card__value">{value}</span>
      <span className="metric-card__label">{label}</span>
    </div>
  );
}
