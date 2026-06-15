import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Loader2,
  ExternalLink,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Info,
  ShieldCheck,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useSaveMetaWAConnection,
  useDraftMetaWAConnection,
  type MetaWAConnection,
} from '@/hooks/useMetaWhatsApp';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: MetaWAConnection | null;
}

const PROJECT_URL = import.meta.env.VITE_SUPABASE_URL;

function maskToken(t: string) {
  if (!t) return '';
  if (t.length <= 8) return '••••' + t.slice(-2);
  return t.slice(0, 4) + '••••••••' + t.slice(-4);
}

export function MetaWhatsAppWizard({ open, onClose, editing }: Props) {
  const { profile } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    display_name: '',
    app_id: '',
    app_secret: '',
    access_token: '',
    phone_number_id: '',
    waba_id: '',
  });
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [verifyToken, setVerifyToken] = useState<string>('');
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [webhookSubscribedAt, setWebhookSubscribedAt] = useState<string | null>(null);

  const draft = useDraftMetaWAConnection();
  const save = useSaveMetaWAConnection();

  const pollRef = useRef<number | null>(null);

  // Reset / hidratação ao abrir.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        display_name: editing.display_name ?? '',
        app_id: editing.app_id ?? '',
        app_secret: '',
        access_token: '',
        phone_number_id: editing.phone_number_id ?? '',
        waba_id: editing.waba_id ?? '',
      });
      setConnectionId(editing.id);
      setVerifyToken(editing.webhook_verify_token);
      setWebhookUrl(`${PROJECT_URL}/functions/v1/meta-whatsapp-webhook/${editing.id}`);
      setWebhookSubscribedAt(editing.webhook_subscribed_at ?? null);
      setStep(editing.status === 'draft' ? 3 : 5);
    } else {
      setStep(1);
      setConnectionId(null);
      setVerifyToken('');
      setWebhookUrl('');
      setWebhookSubscribedAt(null);
      setForm({
        display_name: '',
        app_id: '',
        app_secret: '',
        access_token: '',
        phone_number_id: '',
        waba_id: '',
      });
    }
  }, [editing, open]);

  // Polling do webhook_subscribed_at enquanto estiver no passo 3.
  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!open || step !== 3 || !connectionId || webhookSubscribedAt) return;

    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase
        .from('whatsapp_meta_connections' as any)
        .select('webhook_subscribed_at')
        .eq('id', connectionId)
        .maybeSingle();
      const ts = (data as any)?.webhook_subscribed_at ?? null;
      if (ts) {
        setWebhookSubscribedAt(ts);
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 4000);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, step, connectionId, webhookSubscribedAt]);

  const goToStep3 = async () => {
    if (!profile?.organization_id) return;
    const name = form.display_name.trim() || 'WhatsApp Oficial';
    try {
      const data = await draft.mutateAsync({
        organization_id: profile.organization_id,
        display_name: name,
        connection_id: connectionId ?? undefined,
      });
      setConnectionId(data.connection_id);
      setVerifyToken(data.verify_token);
      setWebhookUrl(data.webhook_url);
      setWebhookSubscribedAt(data.webhook_subscribed_at ?? null);
      if (!form.display_name) setForm((f) => ({ ...f, display_name: name }));
      setStep(3);
    } catch {
      // toast ya disparado pelo hook
    }
  };

  const handleSave = async () => {
    if (!profile?.organization_id || !connectionId) return;
    const payload: any = {
      organization_id: profile.organization_id,
      connection_id: connectionId,
      display_name: form.display_name,
      app_id: form.app_id,
      phone_number_id: form.phone_number_id,
      waba_id: form.waba_id,
    };
    if (form.app_secret) payload.app_secret = form.app_secret;
    if (form.access_token) payload.access_token = form.access_token;
    try {
      await save.mutateAsync(payload);
      toast.success('WhatsApp Oficial conectado com éxito.');
      onClose();
    } catch (e: any) {
      toast.error(
        e?.message ??
          'No conseguimos validar sus credenciais. Verifique App ID, App Secret, Phone Number ID, WABA ID e Access Token permanente.',
      );
    }
  };

  const copy = (s: string) => {
    if (!s) return;
    navigator.clipboard.writeText(s);
    toast.success('Copiado');
  };

  const checklist = [
    { label: 'App Meta creado', done: step >= 3 },
    { label: 'Producto WhatsApp adicionado', done: step >= 3 },
    { label: 'Webhook configurado na Meta', done: !!webhookSubscribedAt },
    { label: 'Credenciais coladas', done: step >= 5 && !!form.app_id },
    { label: 'Conexão validada', done: editing?.status === 'active' },
  ];

  const quickGuide = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1">
          <HelpCircle className="h-4 w-4" /> Ver guia rápido
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm">
        <p className="font-medium mb-2">Resumen em 7 passos</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Crea um App Business na Meta.</li>
          <li>Adicione o producto WhatsApp.</li>
          <li>Copie a URL de Callback e o Verify Token do Vendus.</li>
          <li>Cole esses dados no webhook da Meta.</li>
          <li>Genera um token permanente com Usuario do Sistema.</li>
          <li>Cole App ID, App Secret, Phone Number ID, WABA ID e Access Token no Vendus.</li>
          <li>Hacé clic em Validar e guardar.</li>
        </ol>
      </PopoverContent>
    </Popover>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <DialogTitle>WhatsApp Oficial (Meta Cloud API) — Passo {step} de 5</DialogTitle>
              <DialogDescription>
                Conecte su WhatsApp usando o <strong>su próprio Meta App</strong>. Sus credenciais ficam
                criptografadas e visíveis apenas nesta empresa.
              </DialogDescription>
            </div>
            {quickGuide}
          </div>
        </DialogHeader>

        <div className="grid md:grid-cols-[1fr,180px] gap-6">
          {/* Conteúdo */}
          <div className="space-y-4 min-w-0">
            {step === 1 && (
              <div className="space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Antes de comenzar, usted precisa ter:</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                      <li>Uma cuenta empresarial no Meta Business</li>
                      <li>Acesso de administrador ao negocio</li>
                      <li>Um App Meta do tipo <strong>Business</strong></li>
                      <li>Um número de WhatsApp disponível para API</li>
                      <li>Permissão para crear Usuários do Sistema</li>
                      <li>
                        Acesso ao painel{' '}
                        <a
                          href="https://developers.facebook.com"
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          developers.facebook.com
                        </a>
                      </li>
                    </ul>
                  </AlertDescription>
                </Alert>
                <Alert className="border-amber-500/40">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle>Atenção com o número</AlertTitle>
                  <AlertDescription className="text-sm">
                    Se o número ya estiver siendo usado no WhatsApp ou WhatsApp Business App, verifique as
                    regras da Meta antes de conectar na Cloud API. Em alguns casos o número precisa ser
                    migrado ou preparado para uso na API oficial.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Crea o Meta App da su empresa</AlertTitle>
                  <AlertDescription className="space-y-2 mt-2 text-sm">
                    <p>1. Acesse <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="underline">developers.facebook.com/apps</a>.</p>
                    <p>2. Hacé clic em <strong>"Criar App"</strong>.</p>
                    <p>3. Elegí o tipo <strong>"Business"</strong>.</p>
                    <p>4. Usa o nombre da su empresa ou projeto.</p>
                    <p>5. Após crear o App, adicione o producto <strong>WhatsApp</strong>.</p>
                    <p>6. Acesse <strong>WhatsApp &gt; Configuración da API</strong>.</p>
                  </AlertDescription>
                </Alert>
                <Button asChild variant="outline" className="w-full">
                  <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Abrir Meta for Developers
                  </a>
                </Button>
                <Alert className="border-primary/30">
                  <ShieldCheck className="h-4 w-4" />
                  <AlertTitle>Este App Meta será su</AlertTitle>
                  <AlertDescription className="text-sm">
                    O Vendus no cria o App para usted e no usa um App central neste modelo. Usted vai colar
                    sus próprias credenciais nos próximos passos. Usted mantém controle total sobre su cuenta
                    Meta.
                  </AlertDescription>
                </Alert>

                <div>
                  <Label>Nombre desta conexão (opcional)</Label>
                  <Input
                    value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                    placeholder="WhatsApp Oficial — Ventas"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Usado apenas para identificar essa conexão no Vendus.
                  </p>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <Alert className="border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <AlertTitle>Webhook único gerado para esta conexão</AlertTitle>
                  <AlertDescription className="text-sm">
                    Copie os dois valores abaixo e cole no painel do <strong>su Meta App</strong>.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label>URL de callback</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                    <Button size="icon" variant="outline" onClick={() => copy(webhookUrl)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Verificar token</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={verifyToken} className="font-mono text-xs" />
                    <Button size="icon" variant="outline" onClick={() => copy(verifyToken)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Token gerado automaticamente pelo Vendus, único para esta conexão.
                  </p>
                </div>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Onde colar na Meta</AlertTitle>
                  <AlertDescription className="text-sm">
                    <ol className="list-decimal list-inside space-y-1 mt-2">
                      <li>No painel do su App Meta, vá em <strong>WhatsApp</strong>.</li>
                      <li>Acesse <strong>Configuración</strong> (ou <strong>Webhooks</strong>).</li>
                      <li>No campo <em>URL de callback</em>, cole a URL acima.</li>
                      <li>No campo <em>Verificar token</em>, cole o token acima.</li>
                      <li>Deixe <strong>mTLS / certificado de cliente desativado</strong> por enquanto.</li>
                      <li>Hacé clic em <strong>Verificar e guardar</strong>.</li>
                      <li>Depois, assine o evento <Badge variant="secondary">messages</Badge>.</li>
                    </ol>
                  </AlertDescription>
                </Alert>

                <Alert className="border-amber-500/40">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-sm">
                    Sem o Webhook, o Vendus puede até enviar mensajes pela API, mas no conseguirá receber
                    respuestas dos clientes nem actualizar status de entrega.
                  </AlertDescription>
                </Alert>

                {webhookSubscribedAt ? (
                  <Alert className="border-green-500/40 bg-green-50 dark:bg-green-950/30">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertTitle>Webhook validado pela Meta</AlertTitle>
                    <AlertDescription className="text-sm">
                      Recebemos o handshake em{' '}
                      {new Date(webhookSubscribedAt).toLocaleString('es-PY')}.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Aguardando a Meta validar o webhook… clique em "Ya configurei o webhook" para continuar
                    mismo assim.
                  </p>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3 text-sm">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Agora pegue os dados que serão colados no próximo passo</AlertTitle>
                </Alert>
                <div className="space-y-2">
                  <p><strong>App ID</strong> — Painel do App &gt; Configurações &gt; Básico.</p>
                  <p><strong>App Secret</strong> — Painel do App &gt; Configurações &gt; Básico &gt; Chave secreta do app.</p>
                  <p><strong>Phone Number ID</strong> — Painel do App &gt; WhatsApp &gt; Configuración da API.</p>
                  <p><strong>WABA ID</strong> — Painel do App &gt; WhatsApp &gt; Configuración da API.</p>
                  <div>
                    <p><strong>Access Token permanente</strong> — Business Settings &gt; Usuários &gt; Usuários do sistema.</p>
                    <ol className="list-decimal list-inside ml-2 mt-1 space-y-1 text-muted-foreground">
                      <li>Crea ou selecione um System User.</li>
                      <li>Atribua acesso ao App Meta.</li>
                      <li>Atribua acesso à cuenta WhatsApp Business / WABA.</li>
                      <li>
                        Genera um token com as permisos{' '}
                        <code>whatsapp_business_messaging</code> e{' '}
                        <code>whatsapp_business_management</code>.
                      </li>
                    </ol>
                  </div>
                </div>
                <Alert className="border-amber-500/40">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription>
                    No use o token temporário da tela de testes da Meta em produção — ele expira. Usa um
                    token permanente gerado por <strong>Usuario do Sistema</strong>.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-3">
                <div>
                  <Label>Nombre da conexão</Label>
                  <Input
                    value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                    placeholder="WhatsApp Oficial — Ventas"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>App ID</Label>
                    <Input value={form.app_id} onChange={(e) => setForm({ ...form, app_id: e.target.value })} />
                  </div>
                  <div>
                    <Label>
                      App Secret{' '}
                      {editing && (
                        <span className="text-xs text-muted-foreground">(deixe em branco para manter)</span>
                      )}
                    </Label>
                    <Input
                      type="password"
                      value={form.app_secret}
                      onChange={(e) => setForm({ ...form, app_secret: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Phone Number ID</Label>
                    <Input
                      value={form.phone_number_id}
                      onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>WABA ID</Label>
                    <Input
                      value={form.waba_id}
                      onChange={(e) => setForm({ ...form, waba_id: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label>
                    Access Token (System User permanente){' '}
                    {editing && (
                      <span className="text-xs text-muted-foreground">(deixe em branco para manter)</span>
                    )}
                  </Label>
                  <Input
                    type="password"
                    value={form.access_token}
                    onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                  />
                </div>

                <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
                  <p className="font-medium text-sm">Webhook configurado</p>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground shrink-0">URL:</span>
                    <code className="truncate flex-1">{webhookUrl}</code>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(webhookUrl)}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground shrink-0">Verify Token:</span>
                    <code className="truncate flex-1">{maskToken(verifyToken)}</code>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(verifyToken)}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground shrink-0">Status:</span>
                    {webhookSubscribedAt ? (
                      <Badge variant="default" className="bg-green-600">validado</Badge>
                    ) : (
                      <Badge variant="secondary">aguardando validação</Badge>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Checklist lateral */}
          <aside className="hidden md:block">
            <div className="rounded-lg border p-3 sticky top-0">
              <p className="text-xs font-semibold text-muted-foreground mb-2">PROGRESSO</p>
              <ul className="space-y-2 text-sm">
                {checklist.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2
                      className={`h-4 w-4 mt-0.5 shrink-0 ${
                        c.done ? 'text-green-600' : 'text-muted-foreground/30'
                      }`}
                    />
                    <span className={c.done ? '' : 'text-muted-foreground'}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>

        <DialogFooter className="gap-2">
          {step > 1 && step < 5 && (!editing || editing.status === 'draft') && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Voltar
            </Button>
          )}

          {step === 1 && (
            <>
              <Button asChild variant="outline">
                <a href="https://business.facebook.com" target="_blank" rel="noreferrer">
                  Abrir Meta Business
                </a>
              </Button>
              <Button onClick={() => setStep(2)}>Comenzar configuración</Button>
            </>
          )}

          {step === 2 && (
            <Button onClick={goToStep3} disabled={draft.isPending}>
              {draft.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Avançar para o Webhook
            </Button>
          )}

          {step === 3 && <Button onClick={() => setStep(4)}>Ya configurei o webhook</Button>}

          {step === 4 && (
            <Button onClick={() => setStep(5)}>Continuar para colar credenciais</Button>
          )}

          {step === 5 && (
            <Button
              onClick={handleSave}
              disabled={
                save.isPending ||
                !form.display_name ||
                !form.app_id ||
                !form.phone_number_id ||
                !form.waba_id ||
                ((!editing || editing.status === 'draft') && (!form.app_secret || !form.access_token))
              }
            >
              {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Validar e guardar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
