import {
  LinkIcon,
  Workflow,
  CalendarDays,
  CalendarPlus,
  DollarSign,
  Route,
  Package,
  CreditCard,
  ListTodo,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface QuickActionBarProps {
  /** Cria uma nova tarefa para o vendedor (entra em "Minhas Tareas"). */
  onScheduleFollowup?: () => void;
  onSendCadence?: () => void;
  /** Cria um evento de calendário (atalho rápido). */
  onCreateEvent?: () => void;
  /** Cria uma oportunidade de venda. Visível só com lead vinculado. */
  onCreateDeal?: () => void;
  /** Move o lead para outro estágio do funil — opcional. */
  onMoveStageQuick?: (stageId: string) => void;
  pipelineStages?: { id: string; name: string; color: string | null }[];
  currentStageId?: string | null;
  /** Abre seletor de produto do catálogo para enviar como mensagem rica. */
  onPickCatalog?: () => void;
  /** Abre dialog de gerar/enviar link de pagamento. */
  onSendPaymentLink?: () => void;
}

export function QuickActionBar({
  onScheduleFollowup,
  onSendCadence,
  onCreateEvent,
  onCreateDeal,
  onMoveStageQuick,
  pipelineStages = [],
  currentStageId,
  onPickCatalog,
  onSendPaymentLink,
}: QuickActionBarProps) {
  const currentStage = pipelineStages.find((s) => s.id === currentStageId);

  return (
    <div className="flex w-full max-w-full min-w-0 flex-shrink-0 items-center gap-1 overflow-x-auto px-3 py-1.5 border-t border-border bg-muted/20">
      {onPickCatalog && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 shrink-0 text-blue-600 hover:text-blue-700"
              onClick={onPickCatalog}
            >
              <Package className="h-3.5 w-3.5" />
              Catálogo
            </Button>
          </TooltipTrigger>
          <TooltipContent>Enviar producto del catálogo en el chat</TooltipContent>
        </Tooltip>
      )}

      {onSendPaymentLink && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 shrink-0 text-green-600 hover:text-green-700"
              onClick={onSendPaymentLink}
            >
              <CreditCard className="h-3.5 w-3.5" />
              Cobrar
            </Button>
          </TooltipTrigger>
          <TooltipContent>Generar y enviar link de pago</TooltipContent>
        </Tooltip>
      )}

      {onCreateEvent && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 shrink-0 text-emerald-600 hover:text-emerald-700"
              onClick={onCreateEvent}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Nuevo Evento
            </Button>
          </TooltipTrigger>
          <TooltipContent>Crear evento en la agenda ya vinculado a este lead</TooltipContent>
        </Tooltip>
      )}

      {onScheduleFollowup && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 shrink-0" onClick={onScheduleFollowup}>
              <ListTodo className="h-3.5 w-3.5" />
              Tareas
            </Button>
          </TooltipTrigger>
          <TooltipContent>Crear nueva tarea para vos</TooltipContent>
        </Tooltip>
      )}

      {onCreateDeal && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 shrink-0 text-amber-600 hover:text-amber-700"
              onClick={onCreateDeal}
            >
              <DollarSign className="h-3.5 w-3.5" />
              Oportunidad
            </Button>
          </TooltipTrigger>
          <TooltipContent>Registrar una nueva oportunidad en el pipeline</TooltipContent>
        </Tooltip>
      )}

      {onMoveStageQuick && pipelineStages.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 shrink-0">
              <Route className="h-3.5 w-3.5" />
              {currentStage?.name ?? 'Mover etapa'}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
              Mover a etapa
            </div>
            <div className="flex flex-col">
              {pipelineStages.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => onMoveStageQuick(stage.id)}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-muted text-left',
                    stage.id === currentStageId && 'bg-muted font-medium',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: stage.color || 'hsl(var(--muted-foreground))' }}
                  />
                  <span className="truncate">{stage.name}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {onSendCadence && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 shrink-0" onClick={onSendCadence}>
              <CalendarDays className="h-3.5 w-3.5" />
              Cadencia
            </Button>
          </TooltipTrigger>
          <TooltipContent>Iniciar cadencia para el lead</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
