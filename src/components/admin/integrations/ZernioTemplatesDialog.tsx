import { useEffect, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  connectionId: string;
}

interface Tpl {
  id?: string;
  name: string;
  status?: string;
  category?: string;
  language?: string;
}

const statusVariant = (s?: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  const v = (s || '').toUpperCase();
  if (v === 'APPROVED') return 'default';
  if (v === 'REJECTED') return 'destructive';
  if (v === 'PENDING') return 'secondary';
  return 'outline';
};

export function ZernioTemplatesDialog({ open, onClose, connectionId }: Props) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [showForm, setShowForm] = useState(false);

  // form
  const [name, setName] = useState('');
  const [category, setCategory] = useState('MARKETING');
  const [language, setLanguage] = useState('es');
  const [bodyText, setBodyText] = useState('');
  const [footerText, setFooterText] = useState('');

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('zernio-templates', {
      body: { organization_id: orgId, connection_id: connectionId, action, ...extra },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  }, [orgId, connectionId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await call('list');
      setTemplates(d.templates ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudieron cargar las plantillas');
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const handleCreate = async () => {
    if (!name.trim() || !bodyText.trim()) { toast.error('Nombre y cuerpo son obligatorios'); return; }
    setSaving(true);
    try {
      await call('create', {
        name: name.trim(),
        category,
        language: language.trim(),
        body_text: bodyText.trim(),
        ...(footerText.trim() ? { footer_text: footerText.trim() } : {}),
      });
      toast.success('Plantilla enviada a revisión de Meta (puede tardar hasta 24h)');
      setName(''); setBodyText(''); setFooterText('');
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo crear la plantilla');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tplName: string) => {
    try {
      await call('delete', { name: tplName });
      toast.success('Plantilla eliminada');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo eliminar');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Plantillas de WhatsApp (Zernio)</DialogTitle>
          <DialogDescription>
            Las plantillas aprobadas por Meta permiten escribir al cliente <strong>fuera de la ventana de 24h</strong> (follow-ups, reenganche). Las personalizadas pasan por revisión de Meta.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Actualizar
          </Button>
          <Button size="sm" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Nueva plantilla
          </Button>
        </div>

        {showForm && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nombre (minúsculas, sin espacios)</Label>
                <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} placeholder="reenganche_lead" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Categoría</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilidad</SelectItem>
                    <SelectItem value="AUTHENTICATION">Autenticación</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Idioma</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="es">Español (es)</SelectItem>
                    <SelectItem value="es_AR">Español Argentina (es_AR)</SelectItem>
                    <SelectItem value="es_MX">Español México (es_MX)</SelectItem>
                    <SelectItem value="en_US">Inglés (en_US)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cuerpo del mensaje</Label>
              <Textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={4}
                placeholder="Hola {{1}}, vimos que te interesó un vehículo. ¿Seguís buscando? Estamos para ayudarte 🚗"
              />
              <p className="text-[11px] text-muted-foreground">Usá {'{{1}}'}, {'{{2}}'}… para variables que se completan al enviar.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Pie de página (opcional)</Label>
              <Input value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Automaq · Citroën" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={saving || !name.trim() || !bodyText.trim()}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Enviar a revisión
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {templates.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-6">Todavía no hay plantillas. Creá una para poder reenganchar fuera de 24h.</p>
          )}
          {templates.map((t) => (
            <div key={t.name} className="flex items-center gap-2 rounded-md border border-border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.category} · {t.language}</p>
              </div>
              <Badge variant={statusVariant(t.status)} className="text-[10px]">{(t.status || '—').toUpperCase()}</Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(t.name)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
