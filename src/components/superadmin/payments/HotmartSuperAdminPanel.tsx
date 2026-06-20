import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Save, Copy, Check } from 'lucide-react';

interface Plan {
  id: string; name: string; slug: string; price_monthly: number | null;
  hotmart_product_id: string | null; checkout_url_hotmart: string | null;
}

export function HotmartSuperAdminPanel() {
  const supaUrl = import.meta.env.VITE_SUPABASE_URL;
  const webhookUrl = `${supaUrl}/functions/v1/hotmart-webhook?scope=platform`;
  const qc = useQueryClient();

  // ── Hottok de plataforma (hotmart_credentials con organization_id null) ──
  const { data: cred } = useQuery({
    queryKey: ['hotmart-platform-cred'],
    queryFn: async () => {
      const { data } = await supabase.from('hotmart_credentials').select('id, hottok, is_active').is('organization_id', null).limit(1).maybeSingle();
      return data;
    },
  });
  const [hottok, setHottok] = useState('');
  const [savingHottok, setSavingHottok] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (cred?.hottok) setHottok(cred.hottok); }, [cred?.hottok]);

  const saveHottok = async () => {
    setSavingHottok(true);
    try {
      if (cred?.id) {
        const { error } = await supabase.from('hotmart_credentials').update({ hottok: hottok.trim(), is_active: true }).eq('id', cred.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('hotmart_credentials').insert({ organization_id: null, hottok: hottok.trim(), is_active: true } as any);
        if (error) throw error;
      }
      toast.success('Hottok de plataforma guardado');
      qc.invalidateQueries({ queryKey: ['hotmart-platform-cred'] });
    } catch (e: any) { toast.error(e.message ?? 'Error'); }
    finally { setSavingHottok(false); }
  };

  // ── Mapeo de planes ──
  const { data: plans, isLoading } = useQuery({
    queryKey: ['platform-plans-hotmart'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_plans')
        .select('id,name,slug,price_monthly,hotmart_product_id,checkout_url_hotmart')
        .order('display_order', { ascending: true });
      if (error) throw error;
      return (data as unknown as Plan[]) ?? [];
    },
  });
  const [edits, setEdits] = useState<Record<string, { product?: string; url?: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  useEffect(() => {
    if (plans) {
      const init: Record<string, { product?: string; url?: string }> = {};
      plans.forEach((p) => { init[p.id] = { product: p.hotmart_product_id ?? '', url: p.checkout_url_hotmart ?? '' }; });
      setEdits(init);
    }
  }, [plans]);

  const savePlan = async (planId: string) => {
    const e = edits[planId];
    setSavingId(planId);
    try {
      const { error } = await supabase.from('platform_plans')
        .update({ hotmart_product_id: e.product?.trim() || null, checkout_url_hotmart: e.url?.trim() || null } as any)
        .eq('id', planId);
      if (error) throw error;
      toast.success('Plan actualizado');
      qc.invalidateQueries({ queryKey: ['platform-plans-hotmart'] });
    } catch (err: any) { toast.error(err.message ?? 'Error'); }
    finally { setSavingId(null); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pagos — Hotmart</h1>
        <p className="text-sm text-muted-foreground">Cobro de la plataforma vía Hotmart: cuando alguien compra el CRM, se le crea/activa la cuenta automáticamente.</p>
      </div>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings">Configuración</TabsTrigger>
          <TabsTrigger value="plans">Vinculación de planes</TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="pt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Webhook (Postback 2.0)</CardTitle>
              <CardDescription>Pegá esta URL en Hotmart → Herramientas → Webhook/Postback, para TODOS los eventos de compra y suscripción.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hottok (token de seguridad)</CardTitle>
              <CardDescription>El "hottok" que te da Hotmart en la configuración del webhook. Valida que el postback sea legítimo.</CardDescription>
            </CardHeader>
            <CardContent>
              <Label>Hottok de plataforma</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input value={hottok} onChange={(e) => setHottok(e.target.value)} placeholder="ej: abc123..." className="font-mono text-xs" />
                <Button size="sm" onClick={saveHottok} disabled={savingHottok || !hottok.trim()}>
                  {savingHottok ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Guardar
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="pt-4 space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vinculación de planes con productos Hotmart</CardTitle>
              <CardDescription>Para cada plan, ingresá el ID del producto Hotmart. Así, al comprar, sabemos qué plan activar.</CardDescription>
            </CardHeader>
          </Card>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando planes…</div>
          ) : (
            <div className="grid gap-3">
              {plans?.map((plan) => {
                const e = edits[plan.id] ?? {};
                return (
                  <Card key={plan.id}>
                    <CardContent className="pt-6">
                      <div className="font-semibold mb-1">{plan.name}</div>
                      <div className="text-xs text-muted-foreground mb-3">{plan.slug}{plan.price_monthly ? ` · ₲ ${plan.price_monthly}` : ''}</div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <Label>ID del producto Hotmart</Label>
                          <Input value={e.product ?? ''} onChange={(ev) => setEdits((p) => ({ ...p, [plan.id]: { ...p[plan.id], product: ev.target.value } }))} placeholder="ej: 1234567" />
                        </div>
                        <div>
                          <Label>URL de pago (checkout)</Label>
                          <Input value={e.url ?? ''} onChange={(ev) => setEdits((p) => ({ ...p, [plan.id]: { ...p[plan.id], url: ev.target.value } }))} placeholder="https://pay.hotmart.com/..." />
                        </div>
                      </div>
                      <div className="flex justify-end mt-3">
                        <Button size="sm" onClick={() => savePlan(plan.id)} disabled={savingId === plan.id}>
                          {savingId === plan.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />} Guardar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
