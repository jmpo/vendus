import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface LeadEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    position?: string | null;
    temperature?: 'hot' | 'warm' | 'cold' | null;
    lead_origin?: string | null;
  };
  onSave: (updates: Record<string, any>) => Promise<void>;
}

export function LeadEditModal({ isOpen, onClose, lead, onSave }: LeadEditModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    position: '',
    temperature: 'warm' as 'hot' | 'warm' | 'cold',
    lead_origin: ''
  });

  useEffect(() => {
    if (lead && isOpen) {
      setFormData({
        name: lead.name || '',
        email: lead.email || '',
        phone: lead.phone || '',
        company: lead.company || '',
        position: lead.position || '',
        temperature: lead.temperature || 'warm',
        lead_origin: lead.lead_origin || ''
      });
    }
  }, [lead, isOpen]);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('El nombre es obligatorio');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: formData.name.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        company: formData.company.trim() || null,
        position: formData.position.trim() || null,
        temperature: formData.temperature,
        lead_origin: formData.lead_origin.trim() || null
      });
      toast.success('Lead actualizado con éxito');
      onClose();
    } catch (error) {
      console.error('Error updating lead:', error);
      toast.error('Error al actualizar el lead');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nombre del lead"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="email@ejemplo.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="(00) 00000-0000"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company">Empresa</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
                placeholder="Nombre de la empresa"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="position">Cargo</Label>
              <Input
                id="position"
                value={formData.position}
                onChange={(e) => setFormData(prev => ({ ...prev, position: e.target.value }))}
                placeholder="Cargo o función"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="temperature">Temperatura</Label>
              <Select 
                value={formData.temperature} 
                onValueChange={(v) => setFormData(prev => ({ ...prev, temperature: v as 'hot' | 'warm' | 'cold' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot">🔥 Caliente</SelectItem>
                  <SelectItem value="warm">🌡️ Tibio</SelectItem>
                  <SelectItem value="cold">❄️ Frío</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead_origin">Origen del Lead</Label>
            <Input
              id="lead_origin"
              value={formData.lead_origin}
              onChange={(e) => setFormData(prev => ({ ...prev, lead_origin: e.target.value }))}
              placeholder="Ej: Recomendación, Captación en la calle, Conocido, Evento..."
            />
            <p className="text-xs text-muted-foreground">
              Describa cómo llegó el lead hasta usted
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Guardando...
              </>
            ) : (
              'Guardar Cambios'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
