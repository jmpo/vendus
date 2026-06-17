import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, Copy, CheckCircle2, AlertTriangle, Info, Instagram, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  useDraftInstagramConnection,
  useSaveInstagramConnection,
  useTestInstagramConnection,
  type InstagramConnection,
} from '@/hooks/useInstagramConnections';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: InstagramConnection | null;
}

const TOTAL_STEPS = 5;

export function InstagramWizard({ open, onClose, editing }: Props) {
  const { profile } = useAuth();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    display_name: '',
    app_id: '',
    app_secret: '',
    fb_page_id: '',
    ig_business_account_id: '',
    page_access_token: '',
  });
  const [draftId, setDraftId] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [webhookOk, setWebhookOk] = useState(false);

  const draft = useDraftInstagramConnection();
  const save = useSaveInstagramConnection();
  const test = useTestInstagramConnection();

  // Reset / hydrate on open
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        display_name: editing.display_name ?? '',
        app_id: editing.app_id ?? '',
        app_secret: '',
        fb_page_id: editing.fb_page_id ?? '',
        ig_business_account_id: editing.ig_business_account_id ?? '',
        page_access_token: '',
      });
      setDraftId(editing.id);
      setVerifyToken(editing.webhook_verify_token ?? '');
      setWebhookUrl(
        editing.id
          ? `${(import.meta.env.VITE_SUPABASE_URL as string) ?? ''}/functions/v1/instagram-webhook/${editing.id}`
          : ''
      );
      setWebhookOk(!!editing.webhook_subscribed_at);
      setStep(editing.status === 'draft' ? 3 : 4);
    } else {
      setStep(1);
      setDraftId(null);
      setWebhookUrl('');
      setVerifyToken('');
      setWebhookOk(false);
      setForm({ display_name: '', app_id: '', app_secret: '', fb_page_id: '', ig_business_account_id: '', page_access_token: '' });
    }
  }, [editing, open]);

  // Poll webhook_subscribed_at while in step 3
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (step !== 3 || !draftId || webhookOk) return;
    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase
        .from('instagram_connections' as any)
        .select('webhook_subscribed_at')
        .eq('id', draftId)
        .maybeSingle();
      if ((data as any)?.webhook_subscribed_at) {
        setWebhookOk(true);
        if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      }
    }, 3000);
    return () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };
  }, [step, draftId, webhookOk]);

  const handleCreateDraft = async () => {
    if (!profile?.organization_id) return;
    if (!form.display_name.trim()) { toast.error('Dê um nombre para esta conexión'); return; }
    const res = await draft.mutateAsync({
      organization_id: profile.organization_id,
      display_name: form.display_name.trim(),
      connection_id: draftId ?? undefined,
    });
    setDraftId(res.connection_id);
    setWebhookUrl(res.webhook_url);
    setVerifyToken(res.verify_token);
    setWebhookOk(!!res.webhook_subscribed_at);
    setStep(3);
  };

  const handleActivate = async () => {
    if (!profile?.organization_id || !draftId) return;
    if (!form.app_id || !form.fb_page_id || !form.ig_business_account_id || !form.page_access_token) {
      toast.error('Completá todos los campos'); return;
    }
    const res: any = await save.mutateAsync({
      connection_id: draftId,
      organization_id: profile.organization_id,
      display_name: form.display_name,
      app_id: form.app_id,
      app_secret: form.app_secret || undefined,
      fb_page_id: form.fb_page_id,
      ig_business_account_id: form.ig_business_account_id,
      page_access_token: form.page_access_token,
    });
    if (res?.ok) onClose();
  };

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success('Copiado'); };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Instagram className="h-5 w-5 text-pink-500" />
            Instagram Direct (Meta) — Passo {step} de {TOTAL_STEPS}
          </DialogTitle>
          <DialogDescription>
            Conexión BYO: usted usa su propio Meta App, su Página do Facebook e su cuenta Instagram profissional.
            Credenciais ficam criptografadas e só esta empresa as enxerga.
          </DialogDescription>
        </DialogHeader>

        {/* ---------------- STEP 1: Pré-requisitos ---------------- */}
        {step === 1 && (
          <div className="space-y-4">
            <Alert className="border-pink-500/40">
              <ShieldAlert className="h-4 w-4 text-pink-600" />
              <AlertTitle>Esta conexión é SEPARADA do WhatsApp Oficial</AlertTitle>
              <AlertDescription className="text-sm">
                Usa credenciais, webhook e Verify Token <strong>exclusivos do Instagram</strong>.
                No reaproveite a URL nem o token do WhatsApp acá.
              </AlertDescription>
            </Alert>
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Pré-requisitos</AlertTitle>
              <AlertDescription className="space-y-1.5 mt-2 text-sm">
                <p>• Cuenta Instagram convertida em <strong>Business ou Creator</strong>.</p>
                <p>• <strong>Página do Facebook</strong> vinculada a esa cuenta IG.</p>
                <p>• Cuenta Meta Business + Meta App propio (no use o do WhatsApp).</p>
                <p>• Permisos: <code>instagram_basic</code>, <code>instagram_manage_messages</code>, <code>pages_manage_metadata</code>, <code>pages_messaging</code>, <code>pages_show_list</code>.</p>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* ---------------- STEP 2: Crear Meta App ---------------- */}
        {step === 2 && (
          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Crea su Meta App</AlertTitle>
              <AlertDescription className="space-y-1.5 mt-2 text-sm">
                <p>1. Acesse <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-primary underline">Meta for Developers</a> e crie um App tipo <strong>Business</strong>.</p>
                <p>2. Agregá o producto <strong>Instagram</strong> (Instagram Messaging API) e/ou <strong>Messenger</strong>.</p>
                <p>3. Vincule su <strong>Página do Facebook</strong> e su cuenta <strong>Instagram Business</strong>.</p>
                <p>4. Em Configuraciones → Básico anote <strong>App ID</strong> e <strong>App Secret</strong>.</p>
              </AlertDescription>
            </Alert>
            <Button asChild variant="outline" className="w-full">
              <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />Abrir Meta for Developers
              </a>
            </Button>
            <div className="space-y-2">
              <Label>Nombre da conexión</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Ex.: Instagram @minhamarca"
              />
              <p className="text-xs text-muted-foreground">Usado só internamente para identificar esa conexión.</p>
            </div>
          </div>
        )}

        {/* ---------------- STEP 3: Webhook ---------------- */}
        {step === 3 && (
          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Esa URL é exclusiva da conexión Instagram</AlertTitle>
              <AlertDescription className="text-sm">
                No use a URL do WhatsApp acá. Cada conexión tiene URL e Verify Token propios.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label>URL de callback</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button size="icon" variant="outline" onClick={() => copy(webhookUrl)}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Verify Token</Label>
              <div className="flex gap-2">
                <Input readOnly value={verifyToken} className="font-mono text-xs" />
                <Button size="icon" variant="outline" onClick={() => copy(verifyToken)}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>No painel do su Meta App</AlertTitle>
              <AlertDescription className="space-y-1.5 mt-2 text-sm">
                <p>1. Vá em <strong>Instagram</strong> (ou <strong>Webhooks</strong>) → <strong>Configurar webhooks</strong>.</p>
                <p>2. Cole a <strong>URL de callback</strong> acima.</p>
                <p>3. Cole o <strong>Verify Token</strong> acima.</p>
                <p>4. Deixe <strong>mTLS / certificado de cliente desativado</strong>.</p>
                <p>5. Hacé clic em <strong>Verificar e guardar</strong>.</p>
                <p>6. Assine o campo <strong>messages</strong> (opcional: <code>messaging_postbacks</code>, <code>message_reactions</code>).</p>
              </AlertDescription>
            </Alert>

            {webhookOk ? (
              <Alert className="border-green-500/40 bg-green-50 dark:bg-green-950/30">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>Webhook verificado por la Meta ✅</AlertTitle>
                <AlertDescription>Puede avanzar para colar sus credenciais.</AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertTitle>Aguardando a Meta validar...</AlertTitle>
                <AlertDescription className="text-sm">
                  Cuando usted clicar em "Verificar e guardar" no Meta, a confirmación aparece acá automaticamente.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* ---------------- STEP 4: Credenciais ---------------- */}
        {step === 4 && (
          <div className="space-y-3">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Donde encontrar cada dado</AlertTitle>
              <AlertDescription className="text-sm space-y-1.5 mt-2">
                <p><strong>App ID</strong> + <strong>App Secret</strong>: Meta App → Configuraciones → Básico.</p>
                <p><strong>Page Access Token</strong>: Graph API Explorer → elegí o App → "Get Page Access Token" → troque por long-lived em <code>/oauth/access_token</code>.</p>
                <p><strong>Instagram Business Account ID</strong>: <code>GET /{'{page-id}'}?fields=instagram_business_account</code>.</p>
                <p><strong>Facebook Page ID</strong>: aparece no painel da página ou em <code>/me/accounts</code>.</p>
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>App ID</Label>
                <Input value={form.app_id} onChange={(e) => setForm({ ...form, app_id: e.target.value })} />
              </div>
              <div>
                <Label>App Secret {editing && <span className="text-xs text-muted-foreground">(em branco mantém)</span>}</Label>
                <Input type="password" value={form.app_secret} onChange={(e) => setForm({ ...form, app_secret: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Facebook Page ID</Label>
                <Input value={form.fb_page_id} onChange={(e) => setForm({ ...form, fb_page_id: e.target.value })} />
              </div>
              <div>
                <Label>Instagram Business Account ID</Label>
                <Input value={form.ig_business_account_id} onChange={(e) => setForm({ ...form, ig_business_account_id: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Page Access Token (larga duración)</Label>
              <Input type="password" value={form.page_access_token} onChange={(e) => setForm({ ...form, page_access_token: e.target.value })} />
            </div>

            <p className="text-xs text-muted-foreground">
              Usa um Page Access Token con permisos de Instagram Messaging. Recomendamos usar token de larga duración (60 días).
            </p>
          </div>
        )}

        {/* ---------------- STEP 5: Resumen ---------------- */}
        {step === 5 && (
          <div className="space-y-4">
            <Alert className="border-green-500/40 bg-green-50 dark:bg-green-950/30">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>Pronto para ativar</AlertTitle>
              <AlertDescription className="text-sm">
                Vamos validar sus credenciais na Graph API, criptografá-las e inscrever su Página no app.
              </AlertDescription>
            </Alert>

            <div className="rounded-md border p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Webhook</span>
                {webhookOk ? <Badge className="bg-green-500/15 text-green-700 border-green-500/30">Verificado por la Meta</Badge>
                : <Badge variant="secondary">Pendente</Badge>}
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">App ID</span><span className="font-mono text-xs">{form.app_id}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Page ID</span><span className="font-mono text-xs">{form.fb_page_id}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">IG Account ID</span><span className="font-mono text-xs">{form.ig_business_account_id}</span></div>
            </div>

            {!webhookOk && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  O webhook aún no fue verificado por la Meta. Usted puede ativar mismo así, mas só vai receber mensajes después que a Meta validar o webhook.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && step < 5 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>Voltar</Button>
          )}
          {step === 1 && <Button onClick={() => setStep(2)}>Avanzar</Button>}
          {step === 2 && (
            <Button onClick={handleCreateDraft} disabled={draft.isPending || !form.display_name.trim()}>
              {draft.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generar URL e Verify Token
            </Button>
          )}
          {step === 3 && <Button onClick={() => setStep(4)}>Avanzar para credenciais</Button>}
          {step === 4 && <Button onClick={() => setStep(5)}>Revisar e ativar</Button>}
          {step === 5 && (
            <Button onClick={handleActivate} disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Validar e ativar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
