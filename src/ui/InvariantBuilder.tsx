import { useCallback } from 'react';
import type { InvariantDraft, PathDraft } from '../scenario/types';

interface InvariantBuilderProps {
  invariants: InvariantDraft[];
  paths: PathDraft[];
  onChange: (invariants: InvariantDraft[]) => void;
}

let invariantCounter = 1;
export function resetInvariantCounter(v = 1) {
  invariantCounter = v;
}
function nextInvariantId(): string {
  return `inv-${invariantCounter++}`;
}

const INVARIANT_TYPES = [
  { value: 'maxSideEffectCount', label: 'Max Side-Effect Count' },
  { value: 'maxRequestCount', label: 'Max Request Count' },
  { value: 'requiredSuccessCount', label: 'Required Success Count' },
  { value: 'maxCompletionTime', label: 'Max Completion Time' },
  { value: 'noPendingRequests', label: 'No Pending Requests' },
] as const;

export function InvariantBuilder({ invariants, paths, onChange }: InvariantBuilderProps) {
  const addInvariant = useCallback(
    (type: string) => {
      if (!type) return;
      const id = nextInvariantId();
      let inv: InvariantDraft;
      switch (type) {
        case 'maxSideEffectCount':
          inv = { type, id, effectName: '', maxCount: 1 };
          break;
        case 'maxRequestCount':
          inv = { type, id, pathId: paths[0]?.id ?? '', maxCount: 10 };
          break;
        case 'requiredSuccessCount':
          inv = { type, id, pathId: paths[0]?.id ?? '', minCount: 1 };
          break;
        case 'maxCompletionTime':
          inv = { type, id, maxMs: 10000 };
          break;
        case 'noPendingRequests':
          inv = { type, id };
          break;
        default:
          return;
      }
      onChange([...invariants, inv]);
    },
    [invariants, paths, onChange],
  );

  const removeInvariant = useCallback(
    (id: string) => {
      onChange(invariants.filter((inv) => inv.id !== id));
    },
    [invariants, onChange],
  );

  const updateInvariant = useCallback(
    (id: string, updates: Partial<InvariantDraft>) => {
      onChange(invariants.map((inv) => (inv.id === id ? { ...inv, ...updates } : inv)));
    },
    [invariants, onChange],
  );

  return (
    <div className="invariant-builder">
      <h4 className="panel-subheading">Invariants ({invariants.length})</h4>

      {invariants.map((inv) => (
        <div key={inv.id} className="invariant-item" data-testid={`invariant-${inv.id}`}>
          <div className="invariant-item__header">
            <span className="invariant-item__type">{inv.type}</span>
            <button
              className="btn btn--danger btn--sm"
              onClick={() => removeInvariant(inv.id)}
              aria-label={`Remove invariant ${inv.id}`}
            >
              ×
            </button>
          </div>
          <InvariantFields inv={inv} paths={paths} onUpdate={updateInvariant} />
        </div>
      ))}

      <select
        onChange={(e) => {
          addInvariant(e.target.value);
          e.target.value = '';
        }}
        aria-label="Add invariant"
        data-testid="add-invariant-select"
      >
        <option value="">+ Add Invariant...</option>
        {INVARIANT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function InvariantFields({
  inv,
  paths,
  onUpdate,
}: {
  inv: InvariantDraft;
  paths: PathDraft[];
  onUpdate: (id: string, updates: Partial<InvariantDraft>) => void;
}) {
  switch (inv.type) {
    case 'maxSideEffectCount':
      return (
        <div className="invariant-fields">
          <label className="field">
            <span className="label-text">Effect Name</span>
            <input
              className="input"
              value={(inv.effectName as string) ?? ''}
              onChange={(e) => onUpdate(inv.id, { effectName: e.target.value })}
              placeholder="e.g. charge"
              aria-label="Effect name"
            />
          </label>
          <label className="field">
            <span className="label-text">Max Count</span>
            <input
              className="input"
              type="number"
              min={0}
              value={(inv.maxCount as number) ?? ''}
              onChange={(e) =>
                onUpdate(inv.id, { maxCount: e.target.value ? Number(e.target.value) : undefined })
              }
              aria-label="Max count"
            />
          </label>
        </div>
      );

    case 'maxRequestCount':
      return (
        <div className="invariant-fields">
          <label className="field">
            <span className="label-text">Path</span>
            <select
              className="input"
              value={(inv.pathId as string) ?? ''}
              onChange={(e) => onUpdate(inv.id, { pathId: e.target.value })}
              aria-label="Path"
            >
              <option value="">Select path...</option>
              {paths.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.id})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label-text">Max Count</span>
            <input
              className="input"
              type="number"
              min={0}
              value={(inv.maxCount as number) ?? ''}
              onChange={(e) =>
                onUpdate(inv.id, { maxCount: e.target.value ? Number(e.target.value) : undefined })
              }
              aria-label="Max count"
            />
          </label>
        </div>
      );

    case 'requiredSuccessCount':
      return (
        <div className="invariant-fields">
          <label className="field">
            <span className="label-text">Path</span>
            <select
              className="input"
              value={(inv.pathId as string) ?? ''}
              onChange={(e) => onUpdate(inv.id, { pathId: e.target.value })}
              aria-label="Path"
            >
              <option value="">Select path...</option>
              {paths.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.id})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label-text">Min Count</span>
            <input
              className="input"
              type="number"
              min={0}
              value={(inv.minCount as number) ?? ''}
              onChange={(e) =>
                onUpdate(inv.id, { minCount: e.target.value ? Number(e.target.value) : undefined })
              }
              aria-label="Min count"
            />
          </label>
        </div>
      );

    case 'maxCompletionTime':
      return (
        <div className="invariant-fields">
          <label className="field">
            <span className="label-text">Max Time (ms)</span>
            <input
              className="input"
              type="number"
              min={1}
              value={(inv.maxMs as number) ?? ''}
              onChange={(e) =>
                onUpdate(inv.id, { maxMs: e.target.value ? Number(e.target.value) : undefined })
              }
              aria-label="Max time"
            />
          </label>
        </div>
      );

    case 'noPendingRequests':
      return (
        <div className="invariant-fields">
          <span className="label-text" style={{ color: 'var(--color-text-muted)' }}>
            No additional configuration needed.
          </span>
        </div>
      );

    default:
      return null;
  }
}
