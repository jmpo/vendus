import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import type { IntegrationItem } from '@/config/integrationsCatalog';
import { ApiKeysManager } from './ApiKeysManager';
import { WhatsAppConfig } from './WhatsAppConfig';
import { FacebookLeadsConfig } from './FacebookLeadsConfig';
import { EmailConfigManager } from './EmailConfigManager';
import { EmailTemplatesManager } from './EmailTemplatesManager';
import { MassEmailManager } from './MassEmailManager';
import { GoogleCalendarOAuthConfig } from './GoogleCalendarOAuthConfig';
import { HotmartConfigManager } from './HotmartConfigManager';
import { TrendingUp } from 'lucide-react';
import {
  OpenAIConfig,
  ClaudeConfig,
  GeminiConfig,
  LovableAIInfo,
  WebhooksLink,
  AIRoutingConfig,
} from './AIProviderConfigs';

interface IntegrationConfigDrawerProps {
  item: IntegrationItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Conversiones a Meta Ads: ya funcionan solas, esto solo explica dónde se configuran.
 * La config real vive en el editor de etapas del pipeline (evento por etapa) y el
 * Purchase con monto sale automáticamente al ganar un negocio.
 */
function MetaConversionsInfo() {
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border bg-emerald-500/5 border-emerald-500/20 p-4">
        <p className="font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          Activo — no requiere configuración extra
        </p>
        <p className="text-muted-foreground mt-1">
          Los eventos se envían a Meta vía Zernio con la atribución del anuncio
          Click-to-WhatsApp que originó el chat.
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Cómo funciona</p>
        <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
          <li>
            <span className="text-foreground">Eventos de embudo:</span> se configuran por etapa en
            el editor del pipeline (Pipeline → gestionar etapas → "Evento de conversión").
            Cuando un lead entra a la etapa, se dispara el evento.
          </li>
          <li>
            <span className="text-foreground">Venta (Purchase):</span> se envía automáticamente con
            el <em>monto real</em> cuando marcás un negocio como ganado. No configures Purchase
            en una etapa: quedaría duplicado.
          </li>
          <li>
            <span className="text-foreground">Deduplicación:</span> cada evento lleva un ID estable —
            mover el lead varias veces por la misma etapa no infla las métricas.
          </li>
        </ul>
      </div>

      <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-4 text-muted-foreground">
        <p className="font-medium text-foreground">Importante</p>
        <p className="mt-1">
          Meta solo puede atribuir la conversión si la conversación nació de un anuncio
          Click-to-WhatsApp. Para chats orgánicos (número guardado, campañas por plantilla)
          el evento no se puede atribuir y se descarta — es el comportamiento esperado.
        </p>
      </div>
    </div>
  );
}

export function IntegrationConfigDrawer({ item, open, onOpenChange }: IntegrationConfigDrawerProps) {
  const renderBody = () => {
    if (!item?.configKey) return null;
    switch (item.configKey) {
      case 'whatsapp':
        return <WhatsAppConfig />;
      case 'facebook':
        return <FacebookLeadsConfig />;
      case 'email-config':
        return <EmailConfigManager />;
      case 'email-templates':
        return <EmailTemplatesManager />;
      case 'mass-email':
        return <MassEmailManager />;
      case 'google-calendar':
        return <GoogleCalendarOAuthConfig />;
      case 'api-keys':
        return <ApiKeysManager />;
      case 'openai':
        return <OpenAIConfig />;
      case 'anthropic':
        return <ClaudeConfig />;
      case 'gemini':
        return <GeminiConfig />;
      case 'lovable-ai':
        return <LovableAIInfo />;
      case 'ai-routing':
        return <AIRoutingConfig />;
      case 'hotmart':
        return <HotmartConfigManager />;
      case 'meta-conversions':
        return <MetaConversionsInfo />;
      case 'webhooks-link':
        return <WebhooksLink />;
      default:
        return null;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto p-0 sm:max-w-2xl lg:max-w-3xl"
      >
        {item && (
          <>
            <SheetHeader className="sticky top-0 z-10 border-b bg-background/95 px-6 py-4 backdrop-blur">
              <SheetTitle className="flex items-center gap-2">
                {item.logoSrc ? (
                  <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md bg-background ring-1 ring-border">
                    <img src={item.logoSrc} alt="" className="h-full w-full object-cover" />
                  </span>
                ) : (
                  <span className={`flex h-8 w-8 items-center justify-center rounded-md ${item.color}`}>
                    <item.icon className="h-4 w-4" />
                  </span>
                )}
                {item.name}
              </SheetTitle>
              <SheetDescription>{item.description}</SheetDescription>
            </SheetHeader>
            <div className="px-6 py-6">{renderBody()}</div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
