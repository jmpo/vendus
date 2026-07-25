import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Globe } from 'lucide-react';

export type ConnectionProvider = 'zernio';

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
            Conectá tu WhatsApp oficial vía Zernio.
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
