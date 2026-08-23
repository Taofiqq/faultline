import type { SimEvent, EventLog } from '../engine/types';

interface TimelineViewProps {
  events: EventLog;
  selectedSequence: number | null;
  onSelectEvent: (sequence: number | null) => void;
}

const EVENT_COLORS: Record<string, string> = {
  RequestSent: '#4a9eff',
  RequestArrived: '#6db3ff',
  SideEffect: '#fbbf24',
  ResponseSent: '#34d399',
  ResponseReceived: '#34d399',
  ResponseLost: '#f87171',
  TimeoutError: '#f87171',
  CircuitOpenError: '#fb923c',
  CircuitStateChange: '#a78bfa',
  RetryScheduled: '#8b919e',
  SimulationStopped: '#ef4444',
};

const EVENT_ICONS: Record<string, string> = {
  RequestSent: '→',
  RequestArrived: '●',
  SideEffect: '⚡',
  ResponseSent: '←',
  ResponseReceived: '✓',
  ResponseLost: '✗',
  TimeoutError: '⏱',
  CircuitOpenError: '⊘',
  CircuitStateChange: '◐',
  RetryScheduled: '↻',
  SimulationStopped: '■',
};

function getEventTooltip(e: SimEvent): string {
  const lines = [`Type: ${e.type}`, `Time: ${e.timestamp}ms | Seq: ${e.sequence}`];
  if ('pathId' in e) lines.push(`Path: ${e.pathId}`);
  if ('serviceId' in e) lines.push(`Service: ${e.serviceId}`);
  if ('operationId' in e) lines.push(`Operation: ${e.operationId}`);
  if ('attempt' in e) lines.push(`Attempt: ${e.attempt}`);
  if ('deliveryIndex' in e) lines.push(`Delivery: ${e.deliveryIndex}`);
  if ('success' in e) lines.push(`Success: ${e.success}`);
  if ('late' in e) lines.push(`Late: ${e.late}`);
  if ('deduplicated' in e) lines.push(`Deduplicated: ${e.deduplicated}`);
  if ('idempotencyKey' in e) lines.push(`Key: ${e.idempotencyKey}`);
  if ('latency' in e) lines.push(`Latency: ${e.latency}ms`);
  if ('delay' in e) lines.push(`Delay: ${e.delay}ms`);
  if ('newState' in e) lines.push(`Circuit: ${e.newState}`);
  if ('reason' in e) lines.push(`Reason: ${e.reason}`);
  if ('effectName' in e) lines.push(`Effect: ${e.effectName}`);
  return lines.join('\n');
}

function getLane(e: SimEvent): string {
  if ('pathId' in e) return e.pathId;
  if ('serviceId' in e) return e.serviceId;
  return 'system';
}

export function TimelineView({ events, selectedSequence, onSelectEvent }: TimelineViewProps) {
  if (events.length === 0) {
    return <div className="timeline timeline--empty">No events to display.</div>;
  }

  const maxTime = Math.max(...events.map((e) => e.timestamp), 1);
  const lanes = [...new Set(events.map(getLane))];

  return (
    <div className="timeline" role="figure" aria-label="Event timeline">
      <div className="timeline__header">
        <span className="timeline__axis-label">0ms</span>
        <span className="timeline__axis-label">{maxTime}ms</span>
      </div>
      {lanes.map((lane) => {
        const laneEvents = events.filter((e) => getLane(e) === lane);
        return (
          <div key={lane} className="timeline__lane" aria-label={`Lane: ${lane}`}>
            <span className="timeline__lane-label">{lane}</span>
            <div className="timeline__track">
              {laneEvents.map((e) => {
                const left = maxTime > 0 ? (e.timestamp / maxTime) * 100 : 0;
                const isSelected = e.sequence === selectedSequence;
                return (
                  <button
                    key={e.sequence}
                    className={`timeline__event ${isSelected ? 'timeline__event--selected' : ''}`}
                    style={{
                      left: `${left}%`,
                      color: EVENT_COLORS[e.type] ?? '#8b919e',
                      borderColor: isSelected ? '#fff' : 'transparent',
                    }}
                    title={getEventTooltip(e)}
                    aria-label={`${e.type} at ${e.timestamp}ms (seq ${e.sequence})`}
                    onClick={() => onSelectEvent(isSelected ? null : e.sequence)}
                    data-sequence={e.sequence}
                    data-event-type={e.type}
                  >
                    {EVENT_ICONS[e.type] ?? '?'}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
