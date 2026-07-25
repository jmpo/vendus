import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Sparkles, Info } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOrganizationEffectivePlan } from '@/hooks/useOrganizationPlan';
import { supabase } from '@/integrations/supabase/client';
import { ZernioConnectionsPanel } from './ZernioConnectionsPanel';
import { NewConnectionDialog, type ConnectionProvider } from './NewConnectionDialog';
import { toast } from 'sonner';

export function UnifiedConnectionsPanel() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: effectivePlan } = useOrganizationEffectivePlan(profile?.organization_id);

  const { data: zernioConns } = useQuery({
    queryKey: ['zernio-connections', profile?.organization_id],
    enabled: !!profile?.organization_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('zernio_connections')
        .select('id')
        .eq('organization_id', profile!.organization_id);
      return data ?? [];
    },
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [openZernio, setOpenZernio] = useState(false);

  const used = zernioConns?.length ?? 0;
  const limit = effectivePlan?.limits?.max_connections ?? 1;
  const limitReached = used >= limit;

  const handleSelect = (provider: ConnectionProvider) => {
    if (limitReached) {
      toast.error(`Llegaste al límite de ${limit} conexión(es). Hacé upgrade del plan.`);
      return;
    }
    if (provider === 'zernio') setOpenZernio(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold">Tus Conexiones</h3>
          <p className="text-sm text-muted-foreground">
            Gestioná tu WhatsApp conectado vía Zernio.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={limitReached ? 'destructive' : 'secondary'} className="text-sm">
            {used} / {limit} usadas
          </Badge>
          {limitReached ? (
            <Button onClick={() => navigate('/admin?tab=plan')} className="gap-2">
              <Sparkles className="h-4 w-4" />
              Hacer upgrade
            </Button>
          ) : (
            <Button onClick={() => setPickerOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva conexión
            </Button>
          )}
        </div>
      </div>

      {limitReached && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm flex gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <p className="text-foreground">
            Llegaste al límite de <strong>{limit}</strong> conexión(es) de tu plan. Hacé upgrade para crear más conexiones.
          </p>
        </div>
      )}

      <ZernioConnectionsPanel
        hideHeader
        openWizard={openZernio}
        onCloseWizard={() => setOpenZernio(false)}
      />

      <NewConnectionDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelect}
      />
    </div>
  );
}
