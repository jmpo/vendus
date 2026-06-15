import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Loader2, Save, ExternalLink, Sparkles, Webhook, ArrowRight, CheckCircle2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAICredentials, useSaveAICredential, useDeleteAICredential } from '@/hooks/useAIRouting';
import { AIRoutingPanel } from './AIRoutingPanel';

interface AIProviderConfigProps {
  provider: 'openai' | 'anthropic' | 'gemini';
}

const PROVIDER_META = {
  openai: {
    name: 'OpenAI (ChatGPT)',
    placeholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'Obter chave OpenAI',
    helpText: 'Acceda al panel de OpenAI en "API Keys" y cree una nueva clave secreta.',
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    placeholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    docsLabel: 'Obter chave Claude',
    helpText: 'En la consola de Anthropic, vaya a Settings → API Keys y genere una nueva clave.',
  },
  gemini: {
    name: 'Google Gemini',
    placeholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    docsLabel: 'Obter chave Gemini',
    helpText: 'Acceda a Google AI Studio y haga clic en "Create API Key".',
  },
} as const;

function AIProviderConfig({ provider }: AIProviderConfigProps) {
  const meta = PROVIDER_META[provider];
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const { data: credentials = [] } = useAICredentials();
  const save = useSaveAICredential();
  const del = useDeleteAICredential();

  const current = credentials.find((c) => c.provider === provider);
  const isConfigured = !!current;

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast.error('Pegue la API Key antes de guardar');
      return;
    }
    save.mutate(
      { provider, api_key: apiKey.trim() },
      { onSuccess: () => setApiKey('') },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{meta.name}</CardTitle>
        <CardDescription>
          Use su propia cuenta para que la plataforma use este proveedor.
          Por defecto, todo usa <strong>Lovable AI</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConfigured && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-green-700 dark:text-green-400">
                Llave verificada {current?.api_key_masked ? `(${current.api_key_masked})` : ''}
                {current?.last_verified_at
                  ? ` em ${new Date(current.last_verified_at).toLocaleDateString('es-PY')}`
                  : ''}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => del.mutate(provider)}
              disabled={del.isPending}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Eliminar
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label>API Key</Label>
          <div className="relative">
            <Input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={isConfigured ? 'Pegue una nueva llave para reemplazar' : meta.placeholder}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{meta.helpText}</p>
          <p className="text-xs text-muted-foreground">
            La llave se valida con el proveedor antes de guardarse. Luego, elija dónde
            ella será usada en la pestaña <strong>Enrutamiento de IA</strong>.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={save.isPending || !apiKey.trim()}>
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {isConfigured ? 'Actualizar y verificar' : 'Guardar y verificar'}
          </Button>
          <Button variant="outline" asChild>
            <a href={meta.docsUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              {meta.docsLabel}
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function OpenAIConfig() {
  return <AIProviderConfig provider="openai" />;
}
export function ClaudeConfig() {
  return <AIProviderConfig provider="anthropic" />;
}
export function GeminiConfig() {
  return <AIProviderConfig provider="gemini" />;
}
export function AIRoutingConfig() {
  return <AIRoutingPanel />;
}

export function LovableAIInfo() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-lg">Lovable AI</CardTitle>
            <CardDescription>Gateway nativo ya incluido en la plataforma</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-3">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-green-700 dark:text-green-400">
            Ya está activo — no requiere configuración.
          </span>
        </div>
        <p className="text-muted-foreground">
          Lovable AI es el proveedor predeterminado de los agentes. Da acceso a los modelos
          más modernos (Google Gemini e OpenAI GPT) sin necesidad de configurar
          cuentas externas. Ideal para comenzar rápido.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Modelos disponibles: Gemini 2.5 Pro, Flash, Lite e GPT-5.</li>
          <li>Cobrado según el plan de la plataforma.</li>
          <li>Para usar su propia cuenta, configure OpenAI, Claude o Gemini.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

export function WebhooksLink() {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
            <Webhook className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-lg">Webhooks Personalizados</CardTitle>
            <CardDescription>Configurados en Automatización e IA → Webhooks</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Los webhooks personalizados se encuentran en una sección dedicada en el menú lateral.
          Puede crear disparadores, filtros y acciones conectadas a sistemas externos.
        </p>
        <Button onClick={() => navigate('/admin?section=webhooks')}>
          Abrir Webhooks
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
