import { useState, useMemo } from 'react';
import type { SimEvent, EventLog } from '../engine/types';

interface EventTableProps {
  events: EventLog;
  selectedSequence: number | null;
  onSelectEvent: (sequence: number | null) => void;
}

const PAGE_SIZE = 100;

function getOutcome(e: SimEvent): string {
  if (e.type === 'ResponseReceived')
    return e.success ? (e.late ? 'success (late)' : 'success') : 'error';
  if (e.type === 'ResponseSent') return e.success ? 'success' : 'error';
  if (e.type === 'ResponseLost') return 'lost';
  if (e.type === 'TimeoutError') return 'timeout';
  if (e.type === 'CircuitOpenError') return 'rejected';
  if (e.type === 'SimulationStopped') return e.reason;
  return '—';
}

export function EventTable({ events, selectedSequence, onSelectEvent }: EventTableProps) {
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [pathFilter, setPathFilter] = useState<string>('');
  const [opFilter, setOpFilter] = useState<string>('');
  const [page, setPage] = useState(0);

  const eventTypes = useMemo(() => [...new Set(events.map((e) => e.type))], [events]);
  const pathIds = useMemo(
    () => [
      ...new Set(events.filter((e) => 'pathId' in e).map((e) => (e as { pathId: string }).pathId)),
    ],
    [events],
  );

  const filtered = useMemo(() => {
    let result = events;
    if (typeFilter) result = result.filter((e) => e.type === typeFilter);
    if (pathFilter)
      result = result.filter(
        (e) => 'pathId' in e && (e as { pathId: string }).pathId === pathFilter,
      );
    if (opFilter)
      result = result.filter(
        (e) =>
          'operationId' in e && String((e as { operationId: number }).operationId) === opFilter,
      );
    return result;
  }, [events, typeFilter, pathFilter, opFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEvents = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const clearFilters = () => {
    setTypeFilter('');
    setPathFilter('');
    setOpFilter('');
    setPage(0);
  };

  const hasFilters = typeFilter || pathFilter || opFilter;

  return (
    <div className="event-table-container">
      <div className="event-table__filters">
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={pathFilter}
          onChange={(e) => {
            setPathFilter(e.target.value);
            setPage(0);
          }}
          aria-label="Filter by path"
        >
          <option value="">All paths</option>
          {pathIds.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          placeholder="Operation ID"
          value={opFilter}
          onChange={(e) => {
            setOpFilter(e.target.value);
            setPage(0);
          }}
          aria-label="Filter by operation"
          className="input input--sm"
        />
        {hasFilters && (
          <button className="btn btn--sm" onClick={clearFilters} aria-label="Clear filters">
            Clear
          </button>
        )}
        <span className="event-table__count">
          {filtered.length}/{events.length} events
        </span>
      </div>

      <table className="event-table" role="table" aria-label="Event log">
        <thead>
          <tr>
            <th>Seq</th>
            <th>Time (ms)</th>
            <th>Type</th>
            <th>Path/Service</th>
            <th>Op</th>
            <th>Attempt</th>
            <th>Delivery</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {pageEvents.map((e) => {
            const isSelected = e.sequence === selectedSequence;
            return (
              <tr
                key={e.sequence}
                className={`event-table__row ${isSelected ? 'event-table__row--selected' : ''}`}
                onClick={() => onSelectEvent(isSelected ? null : e.sequence)}
                aria-selected={isSelected}
                data-sequence={e.sequence}
              >
                <td>{e.sequence}</td>
                <td>{e.timestamp}</td>
                <td>{e.type}</td>
                <td>
                  {'pathId' in e
                    ? (e as { pathId: string }).pathId
                    : 'serviceId' in e
                      ? (e as { serviceId: string }).serviceId
                      : '—'}
                </td>
                <td>{'operationId' in e ? (e as { operationId: number }).operationId : '—'}</td>
                <td>{'attempt' in e ? (e as { attempt: number }).attempt : '—'}</td>
                <td>
                  {'deliveryIndex' in e ? (e as { deliveryIndex: number }).deliveryIndex : '—'}
                </td>
                <td>{getOutcome(e)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="event-table__pagination">
          <button className="btn btn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="btn btn--sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
