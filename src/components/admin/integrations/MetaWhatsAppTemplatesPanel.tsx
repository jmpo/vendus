import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, RefreshCw, FileText, AlertCircle } from 'lucide-react';
import { useMetaWATemplates, useSyncMetaWATemplates, useSubmitMetaWATemplate, type MetaWAConnection, type MetaWATemplate } from '@/hooks/useMetaWhatsApp';

const statusVariant: Record<string, string> = {
  APPROVED: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  PENDING: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  REJECTED: 'bg-red-500/15 text-red-700 border-red-500/30',
  PAUSED: 'bg-slate-500/15 text-slate-700 border-slate-500/30',
};

export function MetaWhatsAppTemplatesPanel({ connection, onClose }: { connection: MetaWAConnection; onClose: () => void }) {
  const { fecha: templates = [], isLoading } = useMetaWATemplates(connection.id);
  const sync = useSyncMetaWATemplates();
  const submit = useSubmitMetaWATemplate();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', language: 'pt_BR', category: 'UTILITY', body: '' });

  const handleSubmit = async () => {
    await submit.mutateAsync({
      connection_id: connection.id,
      name: form.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      language: form.language,
      category: form.category,
      components: [{ type: 'BODY', text: form.body }],
    });
    setCreating(false);
    setForm({ name: '', language: 'pt_BR', category: 'UTILITY', body: '' });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Templates — {connection.display_name}</DialogTitle>
          <DialogDescription>
            Templates HSM aprovados pela Meta pueden ser enviados fora da janela de 24h.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">{templates.length} template(s)</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => sync.mutate(connection.id)} disabled={sync.isPending}>
              {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sincronizar
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-2" />Novo</Button>
          </div>
        </div>

        {creating && (
          <Card className="p-4 space-y-3 border-primary/40">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nombre (somente minúsculas, números e _)</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="boas_vindas" />
              </div>
              <div>
                <Label>Idioma</Label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pt_BR">Español (BR)</SelectItem>
                    <SelectItem value="en_US">Inglês (US)</SelectItem>
                    <SelectItem value="es_ES">Espanhol</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTILITY">Utility (notificaciones operacionais)</SelectItem>
                  <SelectItem value="MARKETING">Marketing (promocional)</SelectItem>
                  <SelectItem value="AUTHENTICATION">Authentication (códigos OTP)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Corpo (use {'{{1}}'}, {'{{2}}'}... para variáveis)</Label>
              <Textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Hola {{1}}, su pedido {{2}} fue confirmado!" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={submit.isPending || !form.name || !form.body}>
                {submit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Enviar para aprobación
              </Button>
            </div>
          </Card>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : templates.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum template aún. Crea um ou clique em "Sincronizar" para descargar os ya aprovados na Meta.
          </Card>
        ) : (
          <div className="space-y-2">
            {templates.map((t: MetaWATemplate) => (
              <Card key={t.id} className="p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{t.name}</span>
                      <Badge variant="outline" className="text-xs">{t.language}</Badge>
                      <Badge variant="outline" className="text-xs">{t.category}</Badge>
                      <Badge className={statusVariant[t.status] ?? ''} variant="outline">{t.status}</Badge>
                    </div>
                    {t.rejected_reason && (
                      <div className="text-xs text-destructive flex items-start gap-1"><AlertCircle className="h-3 w-3 mt-0.5" />{t.rejected_reason}</div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
