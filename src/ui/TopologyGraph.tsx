import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type OnConnect,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ServiceDraft, PathDraft } from '../scenario/types';

interface TopologyGraphProps {
  services: ServiceDraft[];
  paths: PathDraft[];
  selectedServiceId: string | null;
  selectedPathId: string | null;
  onSelectService: (id: string | null) => void;
  onSelectPath: (id: string | null) => void;
  onAddService: (name: string) => string;
  onConnect: (source: string, destination: string) => string | null;
  onDeleteService: (id: string) => void;
  onDeletePath: (id: string) => void;
}

export function TopologyGraph({
  services,
  paths,
  selectedServiceId,
  selectedPathId,
  onSelectService,
  onSelectPath,
  onAddService,
  onConnect,
}: TopologyGraphProps) {
  const nodes: Node[] = useMemo(
    () =>
      services.map((svc, i) => {
        const isDisconnected = !paths.some((p) => p.source === svc.id || p.destination === svc.id);
        return {
          id: svc.id,
          position: { x: 150 + (i % 4) * 200, y: 100 + Math.floor(i / 4) * 150 },
          data: { label: svc.name + (isDisconnected ? ' ⚠' : '') },
          selected: svc.id === selectedServiceId,
          style: {
            background: svc.id === selectedServiceId ? '#1e3a5f' : '#242833',
            color: '#e4e7ec',
            border: svc.id === selectedServiceId ? '2px solid #4a9eff' : '1px solid #2e3340',
            borderRadius: '6px',
            padding: '8px 16px',
            fontSize: '13px',
            fontFamily: 'var(--font-sans)',
          },
        };
      }),
    [services, paths, selectedServiceId],
  );

  const edges: Edge[] = useMemo(
    () =>
      paths.map((p) => ({
        id: p.id,
        source: p.source,
        target: p.destination,
        label: p.label,
        selected: p.id === selectedPathId,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#8b919e' },
        style: {
          stroke: p.id === selectedPathId ? '#4a9eff' : '#5a6070',
          strokeWidth: p.id === selectedPathId ? 2 : 1,
        },
        labelStyle: { fill: '#8b919e', fontSize: 11 },
      })),
    [paths, selectedPathId],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => onSelectService(node.id),
    [onSelectService],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => onSelectPath(edge.id),
    [onSelectPath],
  );

  const handleConnect: OnConnect = useCallback(
    (params) => {
      if (params.source && params.target) {
        onConnect(params.source, params.target);
      }
    },
    [onConnect],
  );

  const onPaneClick = useCallback(() => {
    onSelectService(null);
    onSelectPath(null);
  }, [onSelectService, onSelectPath]);

  const handleAddService = useCallback(() => {
    onAddService(`Service ${services.length + 1}`);
  }, [onAddService, services.length]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onConnect={handleConnect}
        onPaneClick={onPaneClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2e3340" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
      <button
        className="btn btn--sm"
        onClick={handleAddService}
        style={{ position: 'absolute', top: 8, left: 8, zIndex: 5 }}
        aria-label="Add service"
      >
        + Service
      </button>
    </div>
  );
}
