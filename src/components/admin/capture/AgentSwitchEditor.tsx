import { Label } from '@/components/ui/label';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Bot, UserCog, Loader2 } from 'lucide-react';
import { useProductAgents } from '@/hooks/useProductAgents';
import { AGENT_TYPE_LABELS } from '@/types/agents';

interface AgentSwitchEditorProps {
  productId: string;
  agentId?: string;
  onAgentChange: (agentId: string) => void;
}

export function AgentSwitchEditor({ productId, agentId, onAgentChange }: AgentSwitchEditorProps) {
  const { data: agents, isLoading } = useProductAgents(productId);
  
  // Admin agents are private to the org administrator and must NOT be
  // available as transfer targets in the regular routing flow.
  const activeAgents = agents?.filter(a => a.is_active && a.agent_type !== 'admin') || [];
  const selectedAgent = agents?.find(a => a.id === agentId);

  if (!productId) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <UserCog className="h-4 w-4" />
          Seleccionar Agente
        </Label>
        <p className="text-xs text-muted-foreground">
          Producto no identificado. Guarda el embudo primero.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <UserCog className="h-4 w-4" />
          Seleccionar Agente
        </Label>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando agentes...
        </div>
      </div>
    );
  }

  if (activeAgents.length === 0) {
    return (
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <UserCog className="h-4 w-4" />
          Seleccionar Agente
        </Label>
        <p className="text-xs text-muted-foreground">
          No se encontraron agentes activos para este producto.
          <br />
          Crea agentes na aba "Agentes" do producto.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2">
        <UserCog className="h-4 w-4" />
        Seleccionar Agente
      </Label>
      
      <Select
        value={agentId || ''}
        onValueChange={onAgentChange}
      >
        <SelectTrigger>
          <SelectValue placeholder="Elige un agente..." />
        </SelectTrigger>
        <SelectContent>
          {activeAgents.map(agent => (
            <SelectItem key={agent.id} value={agent.id}>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-orange-500" />
                <span>{agent.name}</span>
                <Badge variant="outline" className="text-[10px] ml-1">
                  {AGENT_TYPE_LABELS[agent.agent_type]}
                </Badge>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      
      {selectedAgent && (
        <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-orange-500" />
            <span className="font-medium text-sm">{selectedAgent.name}</span>
            <Badge variant="outline" className="text-[10px] bg-orange-500/20 text-orange-600 border-orange-500/30">
              {AGENT_TYPE_LABELS[selectedAgent.agent_type]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {selectedAgent.primary_objective}
          </p>
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary" className="text-[10px]">
              Tono: {selectedAgent.tone_style}
            </Badge>
            {selectedAgent.always_end_with_question && (
              <Badge variant="secondary" className="text-[10px]">
                Pregunta final
              </Badge>
            )}
          </div>
        </div>
      )}
      
      <p className="text-xs text-muted-foreground">
        A conversación será transferida para este agente, que usará o Cérebro do Producto 
        mas seguirá sus próprias regras de comportamento.
      </p>
    </div>
  );
}
