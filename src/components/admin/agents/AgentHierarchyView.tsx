import { useMemo, useEffect } from 'react';
import { Package } from 'lucide-react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentTreeNode } from './AgentTreeNode';
import type { AgentWithProduct } from '@/hooks/useProductAgents';
import type { ProductAgent } from '@/types/agents';

interface Product {
  id: string;
  name: string;
}

interface AgentHierarchyViewProps {
  agents: AgentWithProduct[];
  products: Product[];
  executiveAgentId?: string | null;
  onEdit: (agent: ProductAgent) => void;
  onDelete: (agent: ProductAgent) => void;
  onSetDefault: (agent: ProductAgent) => void;
  onDuplicate: (agent: ProductAgent) => void;
  onToggleStatus: (agent: ProductAgent, isActive: boolean) => void;
  onOpenExecutiveTab?: (agent: ProductAgent) => void;
}

const hidden = { opacity: 0 } as const;

// Nodo de agente: reusa AgentTreeNode + handles (invisibles) para conectar aristas.
function AgentFlowNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <>
      <Handle type="target" position={Position.Top} style={hidden} />
      <AgentTreeNode
        agent={d.agent}
        variant={d.variant}
        isExecutive={d.isExecutive}
        onEdit={d.onEdit}
        onDelete={d.onDelete}
        onSetDefault={d.onSetDefault}
        onDuplicate={d.onDuplicate}
        onToggleStatus={d.onToggleStatus}
        onOpenExecutiveTab={d.onOpenExecutiveTab}
      />
      <Handle type="source" position={Position.Bottom} style={hidden} />
    </>
  );
}

// Nodo de "cabecera de producto" (la línea de negocio).
function HeaderFlowNode({ data }: NodeProps) {
  const d = data as any;
  return (
    <>
      <Handle type="target" position={Position.Top} style={hidden} />
      <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border bg-muted/60 shadow-sm">
        <Package className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">{d.name}</span>
        <span className="text-[10px] text-muted-foreground">· {d.count}</span>
      </div>
      <Handle type="source" position={Position.Bottom} style={hidden} />
    </>
  );
}

const nodeTypes = { agent: AgentFlowNode, header: HeaderFlowNode };

const intentLabelForType = (type: string): string => {
  switch (type) {
    case 'sdr': return 'ℹ️ Info / dudas';
    case 'closer': return '🛒 Compra / precio';
    case 'support': return '🛠️ Soporte';
    case 'financial': return '💰 Pago';
    default: return '';
  }
};

export function AgentHierarchyView({
  agents,
  products,
  executiveAgentId,
  onEdit,
  onDelete,
  onSetDefault,
  onDuplicate,
  onToggleStatus,
  onOpenExecutiveTab,
}: AgentHierarchyViewProps) {
  const handlers = { onEdit, onDelete, onSetDefault, onDuplicate, onToggleStatus, onOpenExecutiveTab };

  const { initialNodes, initialEdges } = useMemo(() => {
    const globalAgents = agents.filter((a) => !a.product_id);
    const orch =
      globalAgents.find((a) => a.agent_type === 'orchestrator' && a.is_active) ||
      globalAgents.find((a) => a.agent_type === 'orchestrator') ||
      globalAgents.find((a) => a.agent_type === 'admin' && a.is_default) ||
      globalAgents.find((a) => a.agent_type === 'admin') ||
      null;
    const otherGlobals = globalAgents.filter((a) => a.id !== orch?.id);

    // Agrupar por producto
    const map = new Map<string, { product: Product; agents: AgentWithProduct[] }>();
    for (const a of agents) {
      if (!a.product_id) continue;
      const product = (a.product as Product) || products.find((p) => p.id === a.product_id) || { id: a.product_id, name: 'Producto' };
      if (!map.has(a.product_id)) map.set(a.product_id, { product, agents: [] });
      map.get(a.product_id)!.agents.push(a);
    }
    const order: Record<string, number> = { sdr: 0, closer: 1, support: 2, financial: 3, admin: 4, custom: 5 };
    for (const grp of map.values()) {
      grp.agents.sort((a, b) => (order[a.agent_type] ?? 9) - (order[b.agent_type] ?? 9) || (a.is_default === b.is_default ? a.name.localeCompare(b.name) : a.is_default ? -1 : 1));
    }
    const byProduct = Array.from(map.values());

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const CX = 360;       // centro horizontal
    const COL = 300;      // separación horizontal entre columnas
    let y = 0;

    if (orch) {
      nodes.push({ id: orch.id, type: 'agent', position: { x: CX, y }, data: { agent: orch, variant: 'orchestrator', isExecutive: executiveAgentId === orch.id, ...handlers } });
    }

    // Globales (fila debajo del orquestador)
    y += 200;
    otherGlobals.forEach((g, i) => {
      const x = CX + (i - (otherGlobals.length - 1) / 2) * COL;
      nodes.push({ id: g.id, type: 'agent', position: { x, y }, data: { agent: g, variant: 'global', isExecutive: executiveAgentId === g.id, ...handlers } });
      if (orch) edges.push({ id: `e-${orch.id}-${g.id}`, source: orch.id, target: g.id, label: intentLabelForType(g.agent_type), animated: true, style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 } });
    });

    // Productos (cada uno: header + agentes)
    byProduct.forEach((grp) => {
      y += 220;
      const headerId = `product-header-${grp.product.id}`;
      nodes.push({ id: headerId, type: 'header', position: { x: CX, y }, data: { name: grp.product.name, count: grp.agents.length } });
      if (orch) edges.push({ id: `e-${orch.id}-${headerId}`, source: orch.id, target: headerId, label: 'por producto', style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1.5, strokeDasharray: '4 4' } });

      const ay = y + 130;
      grp.agents.forEach((a, i) => {
        const x = CX + (i - (grp.agents.length - 1) / 2) * COL;
        nodes.push({ id: a.id, type: 'agent', position: { x, y: ay }, data: { agent: a, variant: 'product', isExecutive: executiveAgentId === a.id, ...handlers } });
        edges.push({ id: `e-${headerId}-${a.id}`, source: headerId, target: a.id, label: intentLabelForType(a.agent_type), animated: true, style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 } });
      });
      y = ay;
    });

    return { initialNodes: nodes, initialEdges: edges };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, products, executiveAgentId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => { setNodes(initialNodes); setEdges(initialEdges); }, [initialNodes, initialEdges, setNodes, setEdges]);

  if (agents.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Leyenda: cómo rutea el orquestador */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="text-xs font-semibold mb-2">¿Cómo decide a qué agente derivar? (arrastrá los nodos para ordenar)</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          <span><span className="font-medium text-primary">Orquestador</span> recibe TODO y clasifica marca + intención, luego:</span>
          <span>ℹ️ Info/dudas → <span className="font-medium text-foreground">SDR</span></span>
          <span>🛒 Compra/precio → <span className="font-medium text-foreground">Closer</span> (del producto)</span>
          <span>🛠️ Soporte → <span className="font-medium text-foreground">Soporte</span></span>
          <span>💰 Pago → <span className="font-medium text-foreground">Financiero</span></span>
          <span>🙋 "hablar con humano" → <span className="font-medium text-foreground">persona</span></span>
        </div>
      </div>

      <div className="h-[640px] w-full rounded-lg border bg-background/50">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
