import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ProductAgent } from '@/types/agents';
import {
  GitBranch,
  Tag,
  User,
  Mail,
  FileText,
  Bell,
  ListTodo,
  Calendar,
  Repeat,
  Workflow,
  ArrowRightLeft,
  UserCheck,
  StickyNote,
  Target,
  Thermometer,
} from 'lucide-react';

interface AgentToolsTabProps {
  formData: Partial<ProductAgent>;
  onChange: (updates: Partial<ProductAgent>) => void;
}

interface ToolToggleProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}

function ToolToggle({ icon, label, description, checked, onCheckedChange }: ToolToggleProps) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function AgentToolsTab({ formData, onChange }: AgentToolsTabProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure qué acciones puede realizar el agente de forma autónoma durante las conversaciones.
      </p>

      {/* Pipeline y Calificación */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-blue-500" />
            Pipeline y Calificación
          </CardTitle>
          <CardDescription className="text-xs">Movimiento y calificación de leads</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-1">
          <ToolToggle
            icon={<GitBranch className="h-4 w-4 text-blue-500" />}
            label="Mover lead en el pipeline"
            description="Avanzar o retroceder el lead entre etapas"
            checked={formData.can_update_pipeline ?? false}
            onCheckedChange={(v) => onChange({ can_update_pipeline: v })}
          />
          <ToolToggle
            icon={<Target className="h-4 w-4 text-blue-500" />}
            label="Calificar lead (BANT)"
            description="Registrar calificación basada en presupuesto, autoridad, necesidad y plazo"
            checked={formData.can_qualify ?? false}
            onCheckedChange={(v) => onChange({ can_qualify: v })}
          />
          <ToolToggle
            icon={<Thermometer className="h-4 w-4 text-blue-500" />}
            label="Cambiar temperatura"
            description="Clasificar lead como frío, tibio o caliente"
            checked={formData.can_update_lead ?? false}
            onCheckedChange={(v) => onChange({ can_update_lead: v })}
          />
        </CardContent>
      </Card>

      {/* Gestión del Lead */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <User className="h-4 w-4 text-green-500" />
            Gestión del Lead
          </CardTitle>
          <CardDescription className="text-xs">Actualizar información y categorizar leads</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-1">
          <ToolToggle
            icon={<Tag className="h-4 w-4 text-green-500" />}
            label="Aplicar / eliminar etiquetas"
            description="Categorizar leads con etiquetas automáticamente"
            checked={formData.can_apply_tags ?? false}
            onCheckedChange={(v) => onChange({ can_apply_tags: v })}
          />
          <ToolToggle
            icon={<StickyNote className="h-4 w-4 text-green-500" />}
            label="Agregar notas internas"
            description="Registrar observaciones en el perfil del lead"
            checked={formData.can_add_notes ?? false}
            onCheckedChange={(v) => onChange({ can_add_notes: v })}
          />
        </CardContent>
      </Card>

      {/* Comunicación */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="h-4 w-4 text-purple-500" />
            Comunicación
          </CardTitle>
          <CardDescription className="text-xs">Envío de correos electrónicos, materiales y alertas</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-1">
          <ToolToggle
            icon={<Mail className="h-4 w-4 text-purple-500" />}
            label="Enviar correos electrónicos"
            description="Enviar correos electrónicos automáticos al lead"
            checked={formData.can_send_emails ?? false}
            onCheckedChange={(v) => onChange({ can_send_emails: v })}
          />
          <ToolToggle
            icon={<FileText className="h-4 w-4 text-purple-500" />}
            label="Enviar materiales"
            description="Compartir documentos y materiales de apoyo"
            checked={formData.can_send_materials ?? false}
            onCheckedChange={(v) => onChange({ can_send_materials: v })}
          />
          <ToolToggle
            icon={<Bell className="h-4 w-4 text-purple-500" />}
            label="Notificar al equipo"
            description="Enviar alertas internas a los vendedores"
            checked={formData.can_notify ?? false}
            onCheckedChange={(v) => onChange({ can_notify: v })}
          />
        </CardContent>
      </Card>

      {/* Automatización */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Workflow className="h-4 w-4 text-orange-500" />
            Automatización
          </CardTitle>
          <CardDescription className="text-xs">Tareas, reuniones, secuencias y flujos</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-1">
          <ToolToggle
            icon={<ListTodo className="h-4 w-4 text-orange-500" />}
            label="Crear tareas"
            description="Crear actividades vinculadas al lead"
            checked={formData.can_create_tasks ?? false}
            onCheckedChange={(v) => onChange({ can_create_tasks: v })}
          />
          <ToolToggle
            icon={<Calendar className="h-4 w-4 text-orange-500" />}
            label="Agendar reuniones"
            description="Programar demostraciones y llamadas en el calendario"
            checked={formData.can_schedule_meetings ?? false}
            onCheckedChange={(v) => onChange({ can_schedule_meetings: v })}
          />
          <ToolToggle
            icon={<Repeat className="h-4 w-4 text-orange-500" />}
            label="Iniciar secuencia de seguimiento"
            description="Activar secuencia automática de seguimiento"
            checked={formData.can_start_cadence ?? false}
            onCheckedChange={(v) => onChange({ can_start_cadence: v })}
          />
          <ToolToggle
            icon={<Workflow className="h-4 w-4 text-orange-500" />}
            label="Activar flujos"
            description="Iniciar flujos de chat automáticamente"
            checked={formData.can_trigger_flows ?? false}
            onCheckedChange={(v) => onChange({ can_trigger_flows: v })}
          />
        </CardContent>
      </Card>

      {/* Gestión de atención */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-red-500" />
            Gestión de atención
          </CardTitle>
          <CardDescription className="text-xs">Transferencia y escalada de conversaciones</CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-1">
          <ToolToggle
            icon={<ArrowRightLeft className="h-4 w-4 text-red-500" />}
            label="Transferir a otro agente"
            description="Redirigir conversación a un agente de IA especializado"
            checked={formData.can_transfer ?? false}
            onCheckedChange={(v) => onChange({ can_transfer: v })}
          />
          <ToolToggle
            icon={<UserCheck className="h-4 w-4 text-red-500" />}
            label="Transferir a un humano"
            description="Escalar a la cola de atención humana"
            checked={formData.can_transfer ?? false}
            onCheckedChange={(v) => onChange({ can_transfer: v })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
