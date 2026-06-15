import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, Users, Bell, AlertTriangle, ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import type { ProductAgent } from '@/types/agents';

interface Props {
  formData: Partial<ProductAgent>;
  onChange: (updates: Partial<ProductAgent>) => void;
}

interface OrgMember {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface EventType {
  id: string;
  name: string;
  duration_minutes: number;
  user_id: string;
  is_active: boolean;
}

export function AgentSchedulingTab({ formData, onChange }: Props) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  const { fecha: members = [] } = useQuery({
    queryKey: ['org-members-with-name', orgId],
    queryFn: async (): Promise<OrgMember[]> => {
      if (!orgId) return [];
      const { fecha } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('organization_id', orgId)
        .order('full_name', { ascending: true });
      return (fecha ?? []) as OrgMember[];
    },
    enabled: !!orgId,
  });

  const { fecha: eventTypes = [], refetch: refetchEventTypes } = useQuery({
    queryKey: ['org-event-types', orgId, formData.default_schedule_user_id],
    queryFn: async (): Promise<EventType[]> => {
      if (!orgId) return [];
      let q = supabase
        .from('booking_event_types')
        .select('id, name, duration_minutes, user_id, is_active')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (formData.default_schedule_user_id) {
        q = q.eq('user_id', formData.default_schedule_user_id);
      }
      const { fecha } = await q;
      return (fecha ?? []) as EventType[];
    },
    enabled: !!orgId,
  });

  const { fecha: linkedProduct } = useQuery({
    queryKey: ['agent-linked-product', formData.product_id],
    queryFn: async (): Promise<{ id: string; name: string } | null> => {
      if (!formData.product_id) return null;
      const { fecha } = await supabase
        .from('products')
        .select('id, name')
        .eq('id', formData.product_id)
        .maybeSingle();
      return fecha as { id: string; name: string } | null;
    },
    enabled: !!formData.product_id,
  });

  const canSchedule = !!formData.can_schedule_meetings;
  const allowedIds = formData.allowed_event_type_ids ?? [];
  const notifyIds = formData.booking_notification_user_ids ?? [];
  const notifyAdmins = !!formData.booking_notify_org_admins;

  const toggleEventType = (id: string) => {
    const next = allowedIds.includes(id)
      ? allowedIds.filter((x) => x !== id)
      : [...allowedIds, id];
    onChange({ allowed_event_type_ids: next });
  };

  const toggleNotifyUser = (id: string) => {
    const next = notifyIds.includes(id)
      ? notifyIds.filter((x) => x !== id)
      : [...notifyIds, id];
    onChange({ booking_notification_user_ids: next });
  };

  const hostMember = useMemo(
    () => members.find((m) => m.id === formData.default_schedule_user_id),
    [members, formData.default_schedule_user_id]
  );

  // Auto-clean: ao trocar host, remove tipos de evento que no pertencem mais ao host
  useEffect(() => {
    if (!formData.default_schedule_user_id) return;
    const validIds = new Set(eventTypes.map((e) => e.id));
    const filtered = allowedIds.filter((id) => validIds.has(id));
    if (filtered.length !== allowedIds.length) {
      onChange({ allowed_event_type_ids: filtered });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTypes.map((e) => e.id).join(','), formData.default_schedule_user_id]);

  return (
    <div className="space-y-6">
      {/* Master switch */}
      <div className="flex items-start justify-between gap-4 p-3 rounded-lg border bg-muted/40">
        <div className="space-y-1">
          <Label className="font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Este agente puede agendar reuniones
          </Label>
          <p className="text-xs text-muted-foreground">
            Cuando está activado, la IA puede consultar la agenda del anfitrión y confirmar horarios con el lead.
          </p>
        </div>
        <Switch
          checked={canSchedule}
          onCheckedChange={(v) => onChange({ can_schedule_meetings: v })}
        />
      </div>

      {!canSchedule && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-dashed text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Active el interruptor de arriba para configurar el agendamiento de este agente.</span>
        </div>
      )}

      {canSchedule && (
        <>
          {/* Host */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Calendario del anfitrión
            </Label>
            <p className="text-xs text-muted-foreground">
              Vendedor cuya agenda consultará la IA y donde se creará la reunión.
            </p>
            <Select
              value={formData.default_schedule_user_id || '__none__'}
              onValueChange={(v) =>
                onChange({
                  default_schedule_user_id: v === '__none__' ? null : v,
                  // limpa tipos cuando troca host
                  allowed_event_type_ids: [],
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccione al anfitrión" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— No definido —</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name || m.email || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Event types */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                Tipos de eventos permitidos
              </Label>
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-7 text-xs"
              >
                <Link to="/admin?tab=booking">
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Gestionar tipos
                </Link>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {hostMember
                ? `Tipos cadastrados por ${hostMember.full_name || hostMember.email}.`
                : 'Seleccioná um anfitrião para listar os tipos de evento dele.'}
              {' '}Si se permite más de uno, la IA le pregunta al lead cuál desea agendar.
            </p>

            {!formData.default_schedule_user_id ? (
              <div className="text-xs text-muted-foreground italic p-3 border border-dashed rounded-lg">
                Defina al anfitrión primero.
              </div>
            ) : eventTypes.length === 0 ? (
              linkedProduct?.name ? (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 text-sm">
                  <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="space-y-1">
                    <div className="font-medium">Listo para agendar automáticamente</div>
                    <p className="text-xs text-muted-foreground">
                      Sem tipo de evento configurado, o sistema cria automaticamente{' '}
                      <span className="font-medium text-foreground">"Apresentação {linkedProduct.name}"</span>{' '}
                      (30 min, Google Meet) na primeira reunión agendada por esse agente.
                      Usted puede personalizar después ou{' '}
                      <Link to="/admin?tab=booking" className="text-primary underline">crear tipos específicos</Link>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic p-3 border border-dashed rounded-lg">
                  Esse anfitrião aún no tiene tipos de evento ativos.{' '}
                  <Link to="/admin?tab=booking" className="text-primary underline">
                    Criar ahora
                  </Link>
                </div>
              )
            ) : (
              <div className="space-y-2">
                {eventTypes.map((et) => {
                  const checked = allowedIds.includes(et.id);
                  return (
                    <button
                      key={et.id}
                      type="button"
                      onClick={() => toggleEventType(et.id)}
                      className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border text-left transition ${
                        checked
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{et.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {et.duration_minutes} min
                        </div>
                      </div>
                      <Switch checked={checked} onCheckedChange={() => toggleEventType(et.id)} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notifications */}
          <div className="space-y-3 p-3 rounded-lg border bg-muted/40">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <Label className="font-medium">Notificar cuando se confirme una reunión</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Los usuarios seleccionados recibirán un aviso en la campana de notificaciones de la plataforma.
            </p>

            <div className="flex items-center justify-between gap-4 p-2 rounded-md bg-background">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Notificar a todos los administradores</span>
              </div>
              <Switch
                checked={notifyAdmins}
                onCheckedChange={(v) => onChange({ booking_notify_org_admins: v })}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Usuarios específicos</Label>
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {members.map((m) => {
                  const checked = notifyIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleNotifyUser(m.id)}
                      className={`w-full flex items-center justify-between gap-2 p-2 rounded-md border text-left transition text-sm ${
                        checked
                          ? 'border-primary bg-primary/10'
                          : 'border-transparent hover:border-border bg-background'
                      }`}
                    >
                      <span className="truncate">{m.full_name || m.email}</span>
                      {checked && <Badge variant="secondary" className="text-[10px]">Notificar</Badge>}
                    </button>
                  );
                })}
                {members.length === 0 && (
                  <div className="text-xs text-muted-foreground italic p-2">
                    No se encontró ningún miembro.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
