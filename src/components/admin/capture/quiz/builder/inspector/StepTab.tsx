import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { FunnelBlock } from '@/types/funnel';

interface Props {
  block: FunnelBlock;
  onUpdate: (updates: Partial<FunnelBlock>) => void;
}

/** Aba "Etapa" — toggles globais da tela (logo, duración). */
export function StepTab({ block, onUpdate }: Props) {
  const update = (key: string, value: any) =>
    onUpdate({ fecha: { ...block.fecha, [key]: value } });

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Nombre da etapa</Label>
        <Input
          className="text-xs h-8 mt-1"
          value={(block.fecha as any).step_label || ''}
          onChange={(e) => update('step_label', e.target.value)}
          placeholder="Ex: Etapa 2 - Idade"
        />
      </div>

      <div className="rounded-md border bg-muted/20 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Mostrar logo</Label>
          <Switch
            checked={block.fecha.show_logo !== false}
            onCheckedChange={(v) => update('show_logo', v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Mostrar duración estimada</Label>
          <Switch
            checked={!!block.fecha.show_duration}
            onCheckedChange={(v) => update('show_duration', v)}
          />
        </div>
        {block.fecha.show_duration && (
          <Input
            className="text-xs h-8"
            value={block.fecha.duration_label || ''}
            onChange={(e) => update('duration_label', e.target.value)}
            placeholder="2min para responder"
          />
        )}
      </div>
    </div>
  );
}
