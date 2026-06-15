import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Copy, Check, Link as LinkIcon } from 'lucide-react';
import {
  useCreateOrganization,
  useCreateSubscription,
  useCreateAuditLog,
} from '@/hooks/useSuperAdmin';
import { supabase } from '@/integrations/supabase/client';
import { useActivePlans, PlatformPlan } from '@/hooks/usePlatformPlans';
import { getPublicAppUrl } from '@/lib/publicUrl';

interface Props {
  onCreated?: (org: any) => void;
  onCancel?: () => void;
  hideEstadoField?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
}

export function OrganizationCreateForm({
  onCreated,
  onCancel,
  hideEstadoField,
  submitLabel = 'Crear Empresa',
  cancelLabel = 'Cancelar',
}: Props) {
  const { data: activePlans } = useActivePlans();
  const createOrganization = useCreateOrganization();
  const createSubscription = useCreateSubscription();
  const createAuditLog = useCreateAuditLog();

  const [newOrg, setNewOrg] = useState({
    name: '',
    email: '',
    cnpj: '',
    phone: '',
    max_users: 10,
    max_products: 5,
    status: 'active',
    plan_id: '' as string,
    customize: false,
  });

  const [createdInvite, setCreatedInvite] = useState<{
    token: string;
    email: string;
    org: any;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteLink = createdInvite
    ? `${getPublicAppUrl()}/aceitar-convite?token=${createdInvite.token}`
    : '';

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('¡Enlace copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  const selectedPlan: PlatformPlan | undefined = activePlans?.find(
    (p) => p.id === newOrg.plan_id
  );

  const handleSelectPlan = (planId: string) => {
    const plan = activePlans?.find((p) => p.id === planId);
    setNewOrg((prev) => ({
      ...prev,
      plan_id: planId,
      customize: false,
      max_users: plan?.max_users ?? prev.max_users,
      max_products: plan?.max_products ?? prev.max_products,
    }));
  };

  const handleCreate = async () => {
    if (!newOrg.name.trim() || !newOrg.email.trim()) {
      toast.error('Complete el nombre y correo electrónico de la empresa');
      return;
    }

    try {
      const isCustom = newOrg.customize || !newOrg.plan_id;
      const features =
        !isCustom && selectedPlan
          ? {
              whatsapp: selectedPlan.feature_whatsapp,
              facebook: selectedPlan.feature_facebook,
              instagram: selectedPlan.feature_instagram,
              campaigns: selectedPlan.feature_campaigns,
              scheduling: selectedPlan.feature_scheduling,
              internal_chat: selectedPlan.feature_internal_chat,
              external_api: selectedPlan.feature_external_api,
              kanban: selectedPlan.feature_kanban,
              pipeline: selectedPlan.feature_pipeline,
              integrations: selectedPlan.feature_integrations,
              audio_transcription_ai: selectedPlan.feature_audio_transcription_ai,
              text_correction_ai: selectedPlan.feature_text_correction_ai,
              ai_agents: selectedPlan.feature_ai_agents,
              voice_agents: selectedPlan.feature_voice_agents,
              outreach: selectedPlan.feature_outreach,
              capture_funnels: selectedPlan.feature_capture_funnels,
              forms: selectedPlan.feature_forms,
              webhooks: selectedPlan.feature_webhooks,
            }
          : undefined;

      const org = await createOrganization.mutateAsync({
        name: newOrg.name.trim(),
        email: newOrg.email.trim(),
        cnpj: newOrg.cnpj.trim() || null,
        phone: newOrg.phone.trim() || null,
        max_users: newOrg.max_users,
        max_products: newOrg.max_products,
        status: newOrg.status,
        plan_id: newOrg.plan_id || null,
        ...(features ? { features } : {}),
      });

      if (newOrg.plan_id && selectedPlan) {
        await createSubscription.mutateAsync({
          organization_id: org.id,
          plan_type: selectedPlan.slug,
          plan_id: selectedPlan.id,
          price_monthly: Number(selectedPlan.price_monthly),
        });
      }

      await createAuditLog.mutateAsync({
        action: `Nova empresa criada: ${newOrg.name}`,
        entity_type: 'organization',
        entity_id: org.id,
      });

      // Cria o usuário admin da empresa com o e-mail informado
      let adminInviteToken: string | null = null;
      try {
        const { data: adminResult, error: adminError } = await supabase.functions.invoke(
          'create-organization-admin',
          {
            body: {
              organization_id: org.id,
              email: newOrg.email.trim(),
              full_name: newOrg.name.trim(),
            },
          }
        );
        if (adminError || (adminResult && adminResult.ok === false)) {
          const msg = adminError?.message || adminResult?.error || 'Erro ao criar admin';
          toast.warning(`Empresa criada, mas falhou ao criar admin: ${msg}`);
        } else {
          adminInviteToken = adminResult?.invite_token ?? null;
          toast.success(
            adminResult?.invited
              ? `Empresa criada. Convite enviado para ${newOrg.email.trim()}`
              : `Empresa criada e admin vinculado (${newOrg.email.trim()})`
          );
        }
      } catch (e: any) {
        console.error('create-organization-admin error:', e);
        toast.warning('Empresa criada, mas falhou ao criar admin automaticamente.');
      }

      if (adminInviteToken) {
        setCreatedInvite({ token: adminInviteToken, email: newOrg.email.trim(), org });
      } else {
        onCreated?.(org);
      }
    } catch (error) {
      console.error('Error creating organization:', error);
      toast.error('Error al crear la empresa');
    }
  };

  if (createdInvite) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LinkIcon className="h-4 w-4 text-primary" />
            Invitación Creada
          </div>
          <p className="text-sm text-muted-foreground">
            Comparta este enlace con <strong>{createdInvite.email}</strong>:
          </p>
          <div className="flex items-center gap-2">
            <Input value={inviteLink} readOnly className="font-mono text-xs" />
            <Button type="button" size="icon" variant="outline" onClick={copyLink}>
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">La invitación vence en 7 días</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => onCreated?.(createdInvite.org)}>Concluir</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nombre de la empresa *</Label>
        <Input
          value={newOrg.name}
          onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
          placeholder="Ex: Acme Ltda"
        />
      </div>

      <div className="space-y-2">
        <Label>Correo electrónico *</Label>
        <Input
          type="email"
          value={newOrg.email}
          onChange={(e) => setNewOrg({ ...newOrg, email: e.target.value })}
          placeholder="contato@empresa.com"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>CNPJ</Label>
          <Input
            value={newOrg.cnpj}
            onChange={(e) => setNewOrg({ ...newOrg, cnpj: e.target.value })}
            placeholder="00.000.000/0000-00"
          />
        </div>
        <div className="space-y-2">
          <Label>Telefone</Label>
          <Input
            value={newOrg.phone}
            onChange={(e) => setNewOrg({ ...newOrg, phone: e.target.value })}
            placeholder="(11) 99999-9999"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Plan</Label>
        <Select
          value={newOrg.plan_id || 'none'}
          onValueChange={(value) => {
            if (value === 'none') {
              setNewOrg({ ...newOrg, plan_id: '', customize: true });
            } else {
              handleSelectPlan(value);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione um plano" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin plan (personalizado)</SelectItem>
            {activePlans?.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.name} — {plan.max_users} usuarios · {plan.max_products} productos
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Seleccionar un plan completa automáticamente los límites predeterminados.
        </p>
      </div>

      {newOrg.plan_id && (
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="text-sm font-medium">Personalizar límites</Label>
            <p className="text-xs text-muted-foreground">
              Sobrescribir los valores predeterminados del plan seleccionado
            </p>
          </div>
          <Switch
            checked={newOrg.customize}
            onCheckedChange={(checked) => setNewOrg({ ...newOrg, customize: checked })}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Máx. Usuarios</Label>
          <Input
            type="number"
            min={1}
            value={newOrg.max_users}
            disabled={!!newOrg.plan_id && !newOrg.customize}
            onChange={(e) =>
              setNewOrg({ ...newOrg, max_users: parseInt(e.target.value) || 1 })
            }
          />
        </div>
        <div className="space-y-2">
          <Label>Máx. Productos</Label>
          <Input
            type="number"
            min={1}
            value={newOrg.max_products}
            disabled={!!newOrg.plan_id && !newOrg.customize}
            onChange={(e) =>
              setNewOrg({ ...newOrg, max_products: parseInt(e.target.value) || 1 })
            }
          />
        </div>
      </div>

      {!hideEstadoField && (
        <div className="space-y-2">
          <Label>Estado</Label>
          <Select
            value={newOrg.status}
            onValueChange={(value) => setNewOrg({ ...newOrg, status: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Activo</SelectItem>
              <SelectItem value="suspended">Suspendido</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button onClick={handleCreate} disabled={createOrganization.isPending}>
          {createOrganization.isPending ? 'Creando...' : submitLabel}
        </Button>
      </div>
    </div>
  );
}
