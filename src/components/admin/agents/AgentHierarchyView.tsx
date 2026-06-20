import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Package } from 'lucide-react';
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

interface Connector {
  fromId: string;
  toId: string;
  highlight?: boolean;
  label?: string;
}

const GLOBAL_TYPES = ['admin', 'support', 'financial'];

function ConnectorsSvg({
  containerRef,
  connectors,
  refresh,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  connectors: Connector[];
  refresh: number;
}) {
  const [paths, setPaths] = useState<{ d: string; highlight?: boolean; label?: string; mx: number; my: number }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const compute = () => {
      const container = containerRef.current;
      if (!container) return;
      const cBox = container.getBoundingClientRect();
      setSize({ w: cBox.width, h: cBox.height });

      const next: { d: string; highlight?: boolean; label?: string; mx: number; my: number }[] = [];
      for (const c of connectors) {
        const from = container.querySelector<HTMLElement>(
          `[data-tree-id="${c.fromId}"]`
        );
        const to = container.querySelector<HTMLElement>(
          `[data-tree-id="${c.toId}"]`
        );
        if (!from || !to) continue;
        const fb = from.getBoundingClientRect();
        const tb = to.getBoundingClientRect();
        // Coords relative to container
        const x1 = fb.left - cBox.left + fb.width / 2;
        const y1 = fb.bottom - cBox.top;
        const x2 = tb.left - cBox.left + tb.width / 2;
        const y2 = tb.top - cBox.top;
        const my = (y1 + y2) / 2;
        // Cubic bezier vertical
        const d = `M ${x1},${y1} C ${x1},${my} ${x2},${my} ${x2},${y2}`;
        next.push({ d, highlight: c.highlight, label: c.label, mx: (x1 + x2) / 2, my });
      }
      setPaths(next);
    };

    compute();
    const ro = new ResizeObserver(compute);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', compute);
    // small delay for layout settle after font/load
    const t = setTimeout(compute, 50);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
      clearTimeout(t);
    };
  }, [connectors, containerRef, refresh]);

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={size.w}
      height={size.h}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="hier-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.9" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={p.highlight ? 'url(#hier-gradient)' : 'hsl(var(--border))'}
          strokeWidth={p.highlight ? 2 : 1.5}
          strokeLinecap="round"
        />
      ))}
      {/* Etiquetas de las conexiones (qué dispara cada ruta) */}
      {paths.filter((p) => p.label).map((p, i) => {
        const w = (p.label!.length * 6.2) + 16;
        return (
          <g key={`lbl-${i}`} transform={`translate(${p.mx - w / 2}, ${p.my - 10})`}>
            <rect width={w} height={20} rx={10} fill="hsl(var(--background))" stroke="hsl(var(--border))" />
            <text x={w / 2} y={14} textAnchor="middle" fontSize="11" fill="hsl(var(--foreground))">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Force connector recompute when agent list changes
  useEffect(() => {
    setRefreshTick((t) => t + 1);
  }, [agents]);

  const { orchestrator, globals, byProduct } = useMemo(() => {
    const globalAgents = agents.filter((a) => !a.product_id);
    // Orchestrator: prefer agent_type === 'orchestrator' (real backend orchestrator),
    // fallback to legacy global admin marked default, then any global admin.
    const orch =
      globalAgents.find((a) => a.agent_type === 'orchestrator' && a.is_active) ||
      globalAgents.find((a) => a.agent_type === 'orchestrator') ||
      globalAgents.find((a) => a.agent_type === 'admin' && a.is_default) ||
      globalAgents.find((a) => a.agent_type === 'admin') ||
      null;
    const otherGlobals = globalAgents.filter((a) => a.id !== orch?.id);

    const map = new Map<string, { product: Product; agents: AgentWithProduct[] }>();
    for (const a of agents) {
      if (!a.product_id) continue;
      const product =
        (a.product as Product) ||
        products.find((p) => p.id === a.product_id) || {
          id: a.product_id,
          name: 'Producto',
        };
      if (!map.has(a.product_id)) map.set(a.product_id, { product, agents: [] });
      map.get(a.product_id)!.agents.push(a);
    }
    // sort agents inside each product: SDR -> closer -> support -> others.
    // Within each role, default agents come first so the hierarchy reads as
    // "this is the SDR that the orchestrator routes to first".
    const order: Record<string, number> = {
      sdr: 0,
      closer: 1,
      support: 2,
      financial: 3,
      admin: 4,
      custom: 5,
    };
    for (const grp of map.values()) {
      grp.agents.sort((a, b) => {
        const roleDiff = (order[a.agent_type] ?? 9) - (order[b.agent_type] ?? 9);
        if (roleDiff !== 0) return roleDiff;
        // Default first within the same role
        if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }

    return {
      orchestrator: orch,
      globals: otherGlobals,
      byProduct: Array.from(map.values()),
    };
  }, [agents, products]);

  // Etiqueta de la ruta según el tipo de agente destino (el orquestador deriva por intención).
  const intentLabelForType = (type: string): string | undefined => {
    switch (type) {
      case 'sdr': return 'ℹ️ Info / dudas';
      case 'closer': return '🛒 Compra / precio';
      case 'support': return '🛠️ Soporte';
      case 'financial': return '💰 Pago / financiero';
      default: return undefined;
    }
  };

  // Build connector list
  const connectors: Connector[] = useMemo(() => {
    const out: Connector[] = [];
    if (orchestrator) {
      // Connect Orchestrator to each global agent (highlighted) — etiqueta por su rol
      for (const g of globals) {
        out.push({ fromId: orchestrator.id, toId: g.id, highlight: true, label: intentLabelForType(g.agent_type) });
      }
      // Connect Orchestrator to each product header — deriva al especialista del producto
      for (const grp of byProduct) {
        out.push({
          fromId: orchestrator.id,
          toId: `product-header-${grp.product.id}`,
          highlight: true,
          label: 'por producto',
        });
      }
    }
    for (const grp of byProduct) {
      const headerId = `product-header-${grp.product.id}`;
      for (const a of grp.agents) {
        out.push({ fromId: headerId, toId: a.id, label: intentLabelForType(a.agent_type) });
      }
    }
    return out;
  }, [orchestrator, globals, byProduct]);

  if (agents.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Leyenda: cómo rutea el orquestador */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <p className="text-xs font-semibold mb-2">¿Cómo decide a qué agente derivar?</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="font-medium text-primary">Orquestador</span> recibe TODO y clasifica marca + intención, luego:</span>
          <span className="flex items-center gap-1">ℹ️ Info/dudas → <span className="font-medium text-foreground">SDR</span></span>
          <span className="flex items-center gap-1">🛒 Compra/precio → <span className="font-medium text-foreground">Closer</span> (del producto)</span>
          <span className="flex items-center gap-1">🛠️ Soporte → <span className="font-medium text-foreground">Soporte</span></span>
          <span className="flex items-center gap-1">💰 Pago → <span className="font-medium text-foreground">Financiero</span></span>
          <span className="flex items-center gap-1">🙋 "hablar con humano" → <span className="font-medium text-foreground">persona</span></span>
        </div>
      </div>

    <div ref={containerRef} className="relative w-full overflow-x-auto pb-4">
      <ConnectorsSvg
        containerRef={containerRef}
        connectors={connectors}
        refresh={refreshTick}
      />

      <div className="relative flex flex-col items-center gap-12 min-w-fit px-4 pt-4">
        {/* Orchestrator */}
        {orchestrator && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
              Orquestador
            </span>
            <div data-tree-id={orchestrator.id}>
              <AgentTreeNode
                agent={orchestrator}
                variant="orchestrator"
                isExecutive={!!executiveAgentId && orchestrator.id === executiveAgentId}
                onEdit={onEdit}
                onDelete={onDelete}
                onSetDefault={onSetDefault}
                onDuplicate={onDuplicate}
                onToggleStatus={onToggleStatus}
                onOpenExecutiveTab={onOpenExecutiveTab}
              />
            </div>
          </div>
        )}

        {/* Globais */}
        {globals.length > 0 && (
          <div className="flex flex-col items-center gap-3 w-full">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Globe className="h-3.5 w-3.5" />
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                Agentes Globales
              </span>
            </div>
            <div className="flex flex-wrap items-start justify-center gap-6">
              {globals.map((agent) => (
                <div key={agent.id} data-tree-id={agent.id}>
                  <AgentTreeNode
                    agent={agent}
                    variant="global"
                    isExecutive={!!executiveAgentId && agent.id === executiveAgentId}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onSetDefault={onSetDefault}
                    onDuplicate={onDuplicate}
                    onToggleStatus={onToggleStatus}
                    onOpenExecutiveTab={onOpenExecutiveTab}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Por producto */}
        {byProduct.map((grp) => (
          <div key={grp.product.id} className="flex flex-col items-center gap-4 w-full">
            {/* Section divider */}
            <div className="flex items-center gap-3 w-full max-w-3xl">
              <div className="flex-1 h-px bg-border" />
              <div
                data-tree-id={`product-header-${grp.product.id}`}
                className="flex items-center gap-2 px-4 py-1.5 rounded-full border bg-muted/50"
              >
                <Package className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">{grp.product.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  · {grp.agents.length}
                </span>
              </div>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="flex flex-wrap items-start justify-center gap-6 pt-6">
              {grp.agents.map((agent) => (
                <div key={agent.id} data-tree-id={agent.id}>
                  <AgentTreeNode
                    agent={agent}
                    variant="product"
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onSetDefault={onSetDefault}
                    onDuplicate={onDuplicate}
                    onToggleStatus={onToggleStatus}
                    onOpenExecutiveTab={onOpenExecutiveTab}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
    </div>
  );
}
