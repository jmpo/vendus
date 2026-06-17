import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, Save, Bot, Phone, Clock, Bell, AlertTriangle, Send, Sparkles } from 'lucide-react';
import { useAutoNotificationSettings, useSaveAutoNotificationSettings } from '@/hooks/useAutoNotificationSettings';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

const DOW_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function normalizePhoneInput(raw: string): string {
  let p = raw.replace(/\D/g, '');
  if (p.length >= 10 && p.length <= 11) p = '55' + p;
  return p;
}

export function AdminExecutiveAgentSettings() {
  const { profile } = useAuth();
  const { data: settings, isLoading } = useAutoNotificationSettings();
  const saveSettings = useSaveAutoNotificationSettings();

  // Lista de admins da org
  const { data: admins } = useQuery({
    queryKey: ['org-admins', profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');
      const ids = (roles ?? []).map((r) => r.user_id);
      if (!ids.length) return [];
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('organization_id', profile.organization_id)
        .in('id', ids);
      return profs ?? [];
    },
    enabled: !!profile?.organization_id,
  });

  const [form, setForm] = useState({
    admin_agent_enabled: false,
    admin_whatsapp_number: '',
    admin_user_id: '',
    daily_summary_enabled: true,
    daily_summary_hour: 8,
    weekly_report_enabled: true,
    weekly_report_dow: 1,
    weekly_report_hour: 8,
    realtime_alerts_enabled: true,
    alert_high_value_threshold: 10000,
    alert_unattended_minutes: 15,
    alert_offline_minutes: 30,
    alert_agent_error_threshold: 3,
    alert_meeting_changes: true,
    alert_goal_achieved: true,
  });

  const [hasChanges, setHasChanges] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        admin_agent_enabled: settings.admin_agent_enabled ?? false,
        admin_whatsapp_number: settings.admin_whatsapp_number ?? '',
        admin_user_id: settings.admin_user_id ?? '',
        daily_summary_enabled: settings.daily_summary_enabled ?? true,
        daily_summary_hour: settings.daily_summary_hour ?? 8,
        weekly_report_enabled: settings.weekly_report_enabled ?? true,
        weekly_report_dow: settings.weekly_report_dow ?? 1,
        weekly_report_hour: settings.weekly_report_hour ?? 8,
        realtime_alerts_enabled: settings.realtime_alerts_enabled ?? true,
        alert_high_value_threshold: settings.alert_high_value_threshold ?? 10000,
        alert_unattended_minutes: settings.alert_unattended_minutes ?? 15,
        alert_offline_minutes: settings.alert_offline_minutes ?? 30,
        alert_agent_error_threshold: settings.alert_agent_error_threshold ?? 3,
        alert_meeting_changes: settings.alert_meeting_changes ?? true,
        alert_goal_achieved: settings.alert_goal_achieved ?? true,
      });
    }
  }, [settings]);

  const update = (k: string, v: any) => {
    setForm((prev) => ({ ...prev, [k]: v }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    const payload = {
      ...form,
      admin_whatsapp_number: form.admin_whatsapp_number
        ? normalizePhoneInput(form.admin_whatsapp_number)
        : null,
      admin_user_id: form.admin_user_id || null,
    };
    await saveSettings.mutateAsync(payload);
    setHasChanges(false);
  };

  const handleTest = async () => {
    if (!form.admin_whatsapp_number) {
      toast.error('Registre un WhatsApp antes de probar');
      return;
    }
    setTesting(true);
    try {
      const phone = normalizePhoneInput(form.admin_whatsapp_number);
      const { error } = await supabase.functions.invoke('admin-agent-handle-inbound', {
        body: {
          organization_id: profile?.organization_id,
          message: 'Envíame un resumen de prueba con los datos de hoy.',
          phone,
        },
      });
      if (error) throw error;
      toast.success('¡Mensaje de prueba enviado! Revise su WhatsApp.');
    } catch (e: any) {
      toast.error('Fallo al enviar la prueba: ' + (e?.message ?? 'error'));
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Agente Admin Ejecutivo
            <Badge variant="secondary" className="ml-2 text-xs">
              <Sparkles className="h-3 w-3 mr-1" />
              IA
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Assistente IA exclusivo do administrador. Envia resumos diários e alertas en tiempo real
            via WhatsApp, e responde preguntas sobre pipeline, equipo, financeiro e tareas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || !form.admin_agent_enabled}>
            {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Probar
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || saveSettings.isPending}>
            {saveSettings.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Guardar
          </Button>
        </div>
      </div>

      {/* Master switch + identificação */}
      <Card className="border-primary/20 ring-1 ring-primary/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Activar Agente Admin</CardTitle>
              <CardDescription>
                Cuando está activo, el agente envía resúmenes y responde solo al número configurado a continuación.
              </CardDescription>
            </div>
            <Switch
              checked={form.admin_agent_enabled}
              onCheckedChange={(v) => update('admin_agent_enabled', v)}
            />
          </div>
        </CardHeader>
        {form.admin_agent_enabled && (
          <CardContent className="space-y-4 pt-0">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  WhatsApp del administrador
                </Label>
                <Input
                  placeholder="(11) 99999-9999"
                  value={form.admin_whatsapp_number}
                  onChange={(e) => update('admin_whatsapp_number', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Solo los mensajes de este número se tratan como administrador. El DDI 55 se agrega automáticamente.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Vincular al usuario administrador</Label>
                <Select value={form.admin_user_id || 'none'} onValueChange={(v) => update('admin_user_id', v === 'none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— No vincular —</SelectItem>
                    {(admins ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.full_name || a.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {form.admin_agent_enabled && (
        <>
          {/* Resumen Diario */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Resumen Diario</CardTitle>
                    <CardDescription>KPI del día anterior, todas las mañanas</CardDescription>
                  </div>
                </div>
                <Switch
                  checked={form.daily_summary_enabled}
                  onCheckedChange={(v) => update('daily_summary_enabled', v)}
                />
              </div>
            </CardHeader>
            {form.daily_summary_enabled && (
              <CardContent className="pt-0">
                <div className="flex items-center gap-3 pl-12">
                  <Label className="text-sm text-muted-foreground">Enviar a las</Label>
                  <Select value={String(form.daily_summary_hour)} onValueChange={(v) => update('daily_summary_hour', parseInt(v))}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label className="text-sm text-muted-foreground">(horario de Brasilia)</Label>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Informe Semanal */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-accent/40">
                    <Bell className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Informe Semanal</CardTitle>
                    <CardDescription>Comparativa de la semana actual vs. semana anterior</CardDescription>
                  </div>
                </div>
                <Switch
                  checked={form.weekly_report_enabled}
                  onCheckedChange={(v) => update('weekly_report_enabled', v)}
                />
              </div>
            </CardHeader>
            {form.weekly_report_enabled && (
              <CardContent className="pt-0">
                <div className="flex items-center gap-3 pl-12 flex-wrap">
                  <Label className="text-sm text-muted-foreground">Cada</Label>
                  <Select value={String(form.weekly_report_dow)} onValueChange={(v) => update('weekly_report_dow', parseInt(v))}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOW_LABELS.map((d, i) => (
                        <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label className="text-sm text-muted-foreground">a las</Label>
                  <Select value={String(form.weekly_report_hour)} onValueChange={(v) => update('weekly_report_hour', parseInt(v))}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, i) => (
                        <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Alertas en Tiempo Real */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Alertas en Tiempo Real</CardTitle>
                    <CardDescription>Notificaciones inmediatas cuando se activan los disparadores</CardDescription>
                  </div>
                </div>
                <Switch
                  checked={form.realtime_alerts_enabled}
                  onCheckedChange={(v) => update('realtime_alerts_enabled', v)}
                />
              </div>
            </CardHeader>
            {form.realtime_alerts_enabled && (
              <CardContent className="pt-0 space-y-4">
                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <Label className="text-sm font-medium">Lead de alto valor entra en el pipeline</Label>
                      <p className="text-xs text-muted-foreground">Alertar cuando deal_value ≥ valor a continuación</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">R$</span>
                      <Input
                        type="number"
                        className="w-32"
                        value={form.alert_high_value_threshold}
                        onChange={(e) => update('alert_high_value_threshold', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <Label className="text-sm font-medium">Conversación sin atención</Label>
                      <p className="text-xs text-muted-foreground">Alertar después de X minutos sin respuesta</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        className="w-24"
                        value={form.alert_unattended_minutes}
                        onChange={(e) => update('alert_unattended_minutes', parseInt(e.target.value) || 0)}
                      />
                      <span className="text-sm text-muted-foreground">min</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <Label className="text-sm font-medium">Vendedor fuera de línea en horario comercial</Label>
                      <p className="text-xs text-muted-foreground">Alertar después de X minutos fuera de línea (8h-18h, días hábiles)</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        className="w-24"
                        value={form.alert_offline_minutes}
                        onChange={(e) => update('alert_offline_minutes', parseInt(e.target.value) || 0)}
                      />
                      <span className="text-sm text-muted-foreground">min</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <Label className="text-sm font-medium">Errores consecutivos en el agente de IA</Label>
                      <p className="text-xs text-muted-foreground">Alertar cuando un agente acumule X fallas en 30 min</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        className="w-24"
                        value={form.alert_agent_error_threshold}
                        onChange={(e) => update('alert_agent_error_threshold', parseInt(e.target.value) || 0)}
                      />
                      <span className="text-sm text-muted-foreground">erros</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-sm font-medium">Reuniones confirmadas/canceladas</Label>
                      <p className="text-xs text-muted-foreground">Notificar cuando el estado de una reunión cambie</p>
                    </div>
                    <Switch
                      checked={form.alert_meeting_changes}
                      onCheckedChange={(v) => update('alert_meeting_changes', v)}
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-sm font-medium">Meta atingida</Label>
                      <p className="text-xs text-muted-foreground">Notificar cuando vendedor bater a meta do periodo</p>
                    </div>
                    <Switch
                      checked={form.alert_goal_achieved}
                      onCheckedChange={(v) => update('alert_goal_achieved', v)}
                    />
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          <Card className="bg-muted/30 border-dashed">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Bot className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Como conversar con o agente?</p>
                  <p>
                    Mande cualquier mensaje do su WhatsApp registrado para o número da plataforma e o
                    agente responderá em segundos. Ejemplos: <em>"como está o pipeline hoy?"</em>,{' '}
                    <em>"quem está online?"</em>, <em>"tiene tarea em retraso?"</em>,{' '}
                    <em>"me manda o financeiro do mes"</em>.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
