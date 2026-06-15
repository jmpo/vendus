import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, Bell, Clock, Target, DollarSign, FileText, Zap, Save, Crown, ArrowRight } from 'lucide-react';
import { useAutoNotificationSettings, useSaveAutoNotificationSettings } from '@/hooks/useAutoNotificationSettings';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useNavigate } from 'react-router-dom';

export function AutoNotificationSettings() {
  const { data: settings, isLoading } = useAutoNotificationSettings();
  const saveSettings = useSaveAutoNotificationSettings();
  
  const [formData, setFormData] = useState({
    stalled_lead_enabled: true,
    stalled_lead_days: 3,
    goal_achieved_enabled: true,
    commission_approved_enabled: true,
    daily_report_enabled: true,
    daily_report_hour: 7,
    daily_report_send_email: true,
  });
  
  const [hasChanges, setHasChanges] = useState(false);
  
  useEffect(() => {
    if (settings) {
      setFormData({
        stalled_lead_enabled: settings.stalled_lead_enabled,
        stalled_lead_days: settings.stalled_lead_days,
        goal_achieved_enabled: settings.goal_achieved_enabled,
        commission_approved_enabled: settings.commission_approved_enabled,
        daily_report_enabled: settings.daily_report_enabled,
        daily_report_hour: settings.daily_report_hour,
        daily_report_send_email: settings.daily_report_send_email,
      });
    }
  }, [settings]);
  
  const handleChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };
  
  const handleSave = async () => {
    await saveSettings.mutateAsync(formData);
    setHasChanges(false);
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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Notificaciones Automáticas
          </h3>
          <p className="text-sm text-muted-foreground">
            Configura alertas automáticos basados en eventos del sistema
          </p>
        </div>
        <Button 
          onClick={handleSave} 
          disabled={!hasChanges || saveSettings.isPending}
        >
          {saveSettings.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Guardar
        </Button>
      </div>
      
      <div className="grid gap-4">
        {/* Lead Detenido */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <Clock className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Lead Detenido</CardTitle>
                  <CardDescription>
                    Alertar al vendedor cuando un lead se quede sin contacto
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={formData.stalled_lead_enabled}
                onCheckedChange={(checked) => handleChange('stalled_lead_enabled', checked)}
              />
            </div>
          </CardHeader>
          {formData.stalled_lead_enabled && (
            <CardContent className="pt-0">
              <div className="flex items-center gap-3 pl-12">
                <Label className="text-sm text-muted-foreground">Notificar después de</Label>
                <Select
                  value={String(formData.stalled_lead_days)}
                  onValueChange={(value) => handleChange('stalled_lead_days', parseInt(value))}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 7, 10, 14].map(days => (
                      <SelectItem key={days} value={String(days)}>{days}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label className="text-sm text-muted-foreground">días sin contacto</Label>
              </div>
            </CardContent>
          )}
        </Card>
        
        {/* Meta Alcanzada */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Target className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Meta Alcanzada</CardTitle>
                  <CardDescription>
                    Felicitar al vendedor al alcanzar la meta de ventas
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={formData.goal_achieved_enabled}
                onCheckedChange={(checked) => handleChange('goal_achieved_enabled', checked)}
              />
            </div>
          </CardHeader>
        </Card>
        
        {/* Comisión Aprobada */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <DollarSign className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Comisión Aprobada</CardTitle>
                  <CardDescription>
                    Notificar cuando se apruebe una comisión
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={formData.commission_approved_enabled}
                onCheckedChange={(checked) => handleChange('commission_approved_enabled', checked)}
              />
            </div>
          </CardHeader>
        </Card>
        
        {/* Informe Diario con IA */}
        <Card className="border-border/50 ring-1 ring-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Informe Diario con IA</CardTitle>
                    <Badge variant="secondary" className="text-xs">IA</Badge>
                  </div>
                  <CardDescription>
                    Briefing personalizado con tareas, leads y prioridades del día
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={formData.daily_report_enabled}
                onCheckedChange={(checked) => handleChange('daily_report_enabled', checked)}
              />
            </div>
          </CardHeader>
          {formData.daily_report_enabled && (
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center gap-3 pl-12">
                <Label className="text-sm text-muted-foreground">Enviar a las</Label>
                <Select
                  value={String(formData.daily_report_hour)}
                  onValueChange={(value) => handleChange('daily_report_hour', parseInt(value))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {String(i).padStart(2, '0')}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label className="text-sm text-muted-foreground">todos los días</Label>
              </div>
              
              <div className="flex items-center gap-3 pl-12">
                <Switch
                  id="daily_report_email"
                  checked={formData.daily_report_send_email}
                  onCheckedChange={(checked) => handleChange('daily_report_send_email', checked)}
                />
                <Label htmlFor="daily_report_email" className="text-sm">
                  Enviar también por correo electrónico
                </Label>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
      
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">¿Cómo funciona?</p>
              <p>
                Las notificaciones automáticas son procesadas periódicamente por el sistema. 
                Cada vendedor recibirá alertas personalizadas en la aplicación y por correo electrónico (cuando esté habilitado).
                El sistema evita duplicaciones y respeta las preferencias configuradas.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator className="my-8" />

      <ExecutiveAgentShortcut />
    </div>
  );
}

function ExecutiveAgentShortcut() {
  const navigate = useNavigate();
  const { data: settings } = useAutoNotificationSettings();
  const enabled = !!settings?.admin_agent_enabled;
  const phone = settings?.admin_whatsapp_number ?? '';
  const enabledAlertsCount = [
    settings?.alert_meeting_changes,
    settings?.alert_goal_achieved,
    settings?.alert_product_volume_spike,
    !!settings?.alert_high_value_threshold,
    !!settings?.alert_unattended_minutes,
    !!settings?.alert_offline_minutes,
  ].filter(Boolean).length;

  return (
    <Card className="border-primary/20 ring-1 ring-primary/10 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
      <CardContent className="pt-6 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <Crown className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-semibold">Agente Admin Ejecutivo</h4>
                <Badge variant={enabled ? 'default' : 'outline'} className="text-[10px]">
                  {enabled ? 'Activo' : 'Desactivado'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {enabled
                  ? `WhatsApp: ${phone || 'no configurado'} · Resumen a las ${String(settings?.daily_summary_hour ?? 8).padStart(2, '0')}:00 · ${enabledAlertsCount} alertas habilitadas`
                  : 'Configura el asistente IA del administrador dentro del propio agente.'}
              </p>
            </div>
          </div>
          <Button
            onClick={() => navigate('/admin?section=agents&open=executive')}
            variant="outline"
            className="gap-2 shrink-0"
          >
            Configurar en el agente
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
