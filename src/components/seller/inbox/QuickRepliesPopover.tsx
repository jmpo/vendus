import { useState } from 'react';
import { Search, MessageSquare, Plus, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface QuickReply {
  id: string;
  category: string;
  title: string;
  content: string;
  shortcut: string | null;
  is_personal?: boolean;
  created_by?: string | null;
}

interface QuickRepliesPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (content: string) => void;
  leadName?: string;
  productName?: string;
}

export function QuickRepliesPopover({
  open,
  onOpenChange,
  onSelect,
  leadName = 'Cliente',
  productName = 'nosso producto',
}: QuickRepliesPopoverProps) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  // Crear respuesta personal
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newShortcut, setNewShortcut] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: quickReplies = [], isLoading } = useQuery({
    queryKey: ['quick-replies', profile?.organization_id, profile?.id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];

      // Compartidas del equipo (is_personal=false) + las personales del vendedor
      const { data, error } = await supabase
        .from('quick_replies')
        .select('*')
        .eq('organization_id', profile.organization_id)
        .eq('is_active', true)
        .or(`is_personal.eq.false,created_by.eq.${profile.id}`)
        .order('category', { ascending: true })
        .order('title', { ascending: true });

      if (error) throw error;
      return data as QuickReply[];
    },
    enabled: !!profile?.organization_id && open,
  });

  const handleCreate = async () => {
    if (!profile?.organization_id || !newTitle.trim() || !newContent.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('quick_replies').insert({
        organization_id: profile.organization_id,
        created_by: profile.id,
        is_personal: true,
        category: 'Mías',
        title: newTitle.trim(),
        content: newContent.trim(),
        shortcut: newShortcut.trim() || null,
        is_active: true,
      } as any);
      if (error) throw error;
      toast.success('Respuesta rápida creada');
      setNewTitle(''); setNewContent(''); setNewShortcut(''); setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ['quick-replies'] });
    } catch (e: any) {
      toast.error(e.message ?? 'No se pudo crear');
    } finally {
      setSaving(false);
    }
  };

  // Filter by search
  const filteredReplies = quickReplies.filter(reply =>
    reply.title.toLowerCase().includes(search.toLowerCase()) ||
    reply.content.toLowerCase().includes(search.toLowerCase()) ||
    reply.shortcut?.toLowerCase().includes(search.toLowerCase())
  );

  // Group by category
  const groupedReplies = filteredReplies.reduce((acc, reply) => {
    if (!acc[reply.category]) {
      acc[reply.category] = [];
    }
    acc[reply.category].push(reply);
    return acc;
  }, {} as Record<string, QuickReply[]>);

  // Replace variables in content
  const processContent = (content: string) => {
    return content
      .replace(/\{\{nombre\}\}/gi, leadName)
      .replace(/\{\{producto\}\}/gi, productName)
      .replace(/\{\{name\}\}/gi, leadName)
      .replace(/\{\{product\}\}/gi, productName);
  };

  const handleSelect = (reply: QuickReply) => {
    onSelect(processContent(reply.content));
    onOpenChange(false);
    setSearch('');
  };

  // Default replies if none exist
  const defaultReplies: QuickReply[] = [
    {
      id: 'default-1',
      category: 'Saludos',
      title: 'Bienvenida',
      content: '¡Hola {{nombre}}! 👋\n\n¡Bienvenido(a)! ¿Cómo puedo ayudarte hoy?',
      shortcut: '/ola',
    },
    {
      id: 'default-2',
      category: 'Saludos',
      title: 'Buenos días',
      content: '¡Buenos días, {{nombre}}! ☀️\n\nEspero que estés teniendo un gran día. ¿En qué puedo ayudarte?',
      shortcut: '/bomdia',
    },
    {
      id: 'default-3',
      category: 'Ventas',
      title: 'Presentación del producto',
      content: '¡{{producto}} es la solución perfecta para ti! 🎯\n\n¿Te puedo mostrar cómo puede ayudarte en tu caso específico?',
      shortcut: '/producto',
    },
    {
      id: 'default-4',
      category: 'Ventas',
      title: 'Próximos pasos',
      content: '¡Perfecto, {{nombre}}! ✅\n\n¿Agendamos una demostración para que conozcas mejor {{producto}}?\n\n¿Cuál sería el mejor horario para ti?',
      shortcut: '/demo',
    },
    {
      id: 'default-5',
      category: 'Cierre',
      title: 'Despedida',
      content: '¡Gracias por el contacto, {{nombre}}! 🙏\n\nQuedo a disposición para cualquier duda. ¡Hasta luego!',
      shortcut: '/tchau',
    },
  ];

  const displayReplies = quickReplies.length > 0 ? filteredReplies : defaultReplies.filter(reply =>
    reply.title.toLowerCase().includes(search.toLowerCase()) ||
    reply.content.toLowerCase().includes(search.toLowerCase())
  );

  const displayGrouped = displayReplies.reduce((acc, reply) => {
    if (!acc[reply.category]) {
      acc[reply.category] = [];
    }
    acc[reply.category].push(reply);
    return acc;
  }, {} as Record<string, QuickReply[]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Respuestas rápidas
            </span>
            <Button variant={showCreate ? 'secondary' : 'outline'} size="sm" className="h-7 gap-1" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showCreate ? 'Cerrar' : 'Nueva'}
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* Crear respuesta personal */}
        {showCreate && (
          <div className="px-4 py-3 border-b bg-muted/20 space-y-2">
            <Input placeholder="Título (ej: Saludo inicial)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="h-8" />
            <Textarea
              placeholder="Mensaje… podés usar {{nombre}} y {{producto}}"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={3}
              className="text-sm"
            />
            <div className="flex items-center gap-2">
              <Input placeholder="Atajo opcional (ej: /saludo)" value={newShortcut} onChange={(e) => setNewShortcut(e.target.value)} className="h-8 flex-1" />
              <Button size="sm" className="h-8" onClick={handleCreate} disabled={saving || !newTitle.trim() || !newContent.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null} Guardar
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Será personal (solo vos la verás), además de las del equipo.</p>
          </div>
        )}

        {/* Search */}
        <div className="px-4 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar respuesta o atajo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>
        </div>

        {/* Replies List */}
        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : Object.keys(displayGrouped).length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No se encontró ninguna respuesta</p>
            </div>
          ) : (
            <div className="p-2">
              {Object.entries(displayGrouped).map(([category, replies]) => (
                <div key={category} className="mb-4 last:mb-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
                    {category}
                  </p>
                  <div className="space-y-1">
                    {replies.map((reply) => (
                      <button
                        key={reply.id}
                        onClick={() => handleSelect(reply)}
                        className={cn(
                          "w-full text-left p-3 rounded-lg transition-colors",
                          "hover:bg-accent group"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm">{reply.title}</span>
                              {reply.shortcut && (
                                <Badge variant="secondary" className="text-[10px] h-5">
                                  {reply.shortcut}
                                </Badge>
                              )}
                              {reply.is_personal && (
                                <Badge variant="outline" className="text-[10px] h-5">Mía</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {processContent(reply.content)}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="p-3 border-t bg-muted/30">
          <p className="text-xs text-muted-foreground text-center">
            Usa <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">{'{{nombre}}'}</kbd> e{' '}
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">{'{{producto}}'}</kbd> para variables dinámicas
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
