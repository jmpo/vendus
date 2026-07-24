import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ChevronRight, Globe } from 'lucide-react';

export type ConnectionProvider = 'meta_whatsapp' | 'meta_instagram' | 'zernio';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (provider: ConnectionProvider) => void;
}

interface OptionProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  badge?: { label: string; variant?: 'default' | 'secondary' | 'outline' };
  disabled?: boolean;
  onClick?: () => void;
}

function Option({ icon, iconBg, title, description, badge, disabled, onClick }: OptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-lg border p-4 flex items-center gap-4 transition-colors ${
        disabled
          ? 'opacity-60 cursor-not-allowed border-border'
          : 'hover:border-primary hover:bg-accent/40 border-border'
      }`}
    >
      <div className={`h-11 w-11 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium">{title}</p>
          {badge && <Badge variant={badge.variant ?? 'secondary'} className="text-[10px]">{badge.label}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      {!disabled && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
    </button>
  );
}

export function NewConnectionDialog({ open, onClose, onSelect }: Props) {
  const handle = (p: ConnectionProvider) => { onSelect(p); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva conexión</DialogTitle>
          <DialogDescription>
            Elegí qual tipo de canal usted quiere conectar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <Option
            icon={<Globe className="h-5 w-5 text-sky-600" />}
            iconBg="bg-sky-500/10"
            title="WhatsApp Oficial vía Zernio"
            description="Número virtual oficial (partner de Meta). Solo pegás tu API key — sin QR, sin crear Meta App, sin riesgo de bloqueo. La forma más simple de tener WhatsApp oficial."
            badge={{ label: 'Recomendado', variant: 'default' }}
            onClick={() => handle('zernio')}
          />
          <Option
            icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />}
            iconBg="bg-emerald-500/10"
            title="WhatsApp Oficial (Meta Cloud API)"
            description="API oficial de Meta con plantillas, automatizaciones y envío a escala. Requiere que crees tu propia Meta App. Ideal para empresas que quieren número propio, plantillas aprobadas y mayor estabilidad."
            badge={{ label: 'Avanzado', variant: 'outline' }}
            onClick={() => handle('meta_whatsapp')}
          />
          {/* Instagram Direct fue retirado: sus edge functions ya no existen — ofrecerlo
              sería una conexión que nunca recibe mensajes. Reactivar cuando se reimplante. */}
        </div>
      </DialogContent>
    </Dialog>
  );
}
