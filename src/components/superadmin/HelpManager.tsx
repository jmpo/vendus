import { useState } from 'react';
import { useHelpCategories, useHelpArticles, useUpsertHelpArticle, useDeleteHelpArticle, useUpsertHelpCategory } from '@/hooks/useHelp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RichEditor } from '@/components/editor/RichEditor';
import { Plus, Pencil, Trash2, FileText, FolderOpen, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

export function HelpManager() {
  const { fecha: categories = [] } = useHelpCategories(true);
  const { fecha: articles = [] } = useHelpArticles({});
  const upsertArticle = useUpsertHelpArticle();
  const deleteArticle = useDeleteHelpArticle();
  const upsertCategory = useUpsertHelpCategory();

  const [editingArticle, setEditingArticle] = useState<any | null>(null);
  const [editingCategory, setEditingCategory] = useState<any | null>(null);

  const handleSaveArticle = async () => {
    if (!editingArticle?.title) { toast.error('Título obligatorio'); return; }
    const payload = {
      ...editingArticle,
      slug: editingArticle.slug || slugify(editingArticle.title),
      published_at: editingArticle.is_published ? (editingArticle.published_at || new Date().toISOString()) : null,
    };
    await upsertArticle.mutateAsync(payload);
    toast.success('Artículo guardado');
    setEditingArticle(null);
  };

  const handleSaveCategory = async () => {
    if (!editingCategory?.name) { toast.error('Nombre obligatorio'); return; }
    await upsertCategory.mutateAsync({
      ...editingCategory,
      slug: editingCategory.slug || slugify(editingCategory.name),
    });
    toast.success('Categoría guardada');
    setEditingCategory(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Centro de Ayuda</h2>
          <p className="text-muted-foreground text-sm">Gestione artículos y categorías visibles para todos los usuarios.</p>
        </div>
      </div>

      <Tabs defaultValue="articles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="articles" className="gap-2"><FileText className="h-4 w-4" /> Artículos</TabsTrigger>
          <TabsTrigger value="categories" className="gap-2"><FolderOpen className="h-4 w-4" /> Categorías</TabsTrigger>
        </TabsList>

        <TabsContent value="articles" className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setEditingArticle({ is_published: false, content_json: null, content_html: '', tags: [] })} className="gap-2">
              <Plus className="h-4 w-4" /> Nuevo artículo
            </Button>
          </div>
          {articles.length === 0 ? (
            <Card><CardContent className="text-center py-8 text-muted-foreground">Aún no hay artículos.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {articles.map(a => (
                <Card key={a.id}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{a.title}</div>
                      <div className="text-xs text-muted-foreground flex gap-2">
                        {a.help_categories?.name && <span>{a.help_categories.name}</span>}
                        <span>•</span>
                        <span>{a.view_count || 0} vistas</span>
                      </div>
                    </div>
                    <Badge variant={a.is_published ? 'default' : 'outline'} className="gap-1">
                      {a.is_published ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      {a.is_published ? 'Publicado' : 'Borrador'}
                    </Badge>
                    <Button variant="ghost" size="icon" onClick={() => setEditingArticle(a)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm('¿Eliminar artículo?')) deleteArticle.mutate(a.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="categories" className="space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setEditingCategory({ is_active: true, icon: 'BookOpen', display_order: categories.length })} className="gap-2">
              <Plus className="h-4 w-4" /> Nueva categoría
            </Button>
          </div>
          <div className="grid gap-2">
            {categories.map(c => (
              <Card key={c.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.description || c.slug}</div>
                  </div>
                  <Badge variant={c.is_active ? 'default' : 'outline'}>{c.is_active ? 'Activa' : 'Inactiva'}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => setEditingCategory(c)}><Pencil className="h-4 w-4" /></Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Editor de artigo */}
      <Dialog open={!!editingArticle} onOpenChange={(o) => !o && setEditingArticle(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingArticle?.id ? 'Editar artículo' : 'Nuevo artículo'}</DialogTitle>
          </DialogHeader>
          {editingArticle && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Título</Label>
                  <Input value={editingArticle.title || ''} onChange={(e) => setEditingArticle({ ...editingArticle, title: e.target.value, slug: editingArticle.slug || slugify(e.target.value) })} />
                </div>
                <div>
                  <Label>Categoría</Label>
                  <Select value={editingArticle.category_id || ''} onValueChange={(v) => setEditingArticle({ ...editingArticle, category_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Seleccione" /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Resumen corto</Label>
                <Textarea rows={2} value={editingArticle.summary || ''} onChange={(e) => setEditingArticle({ ...editingArticle, summary: e.target.value })} />
              </div>
              <div>
                <Label>Contenido</Label>
                <RichEditor
                  value={editingArticle.content_json ?? editingArticle.content_html}
                  onChange={(json, html) => setEditingArticle({ ...editingArticle, content_json: json, content_html: html })}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={!!editingArticle.is_published} onCheckedChange={(v) => setEditingArticle({ ...editingArticle, is_published: v })} />
                <Label>Publicar artículo</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingArticle(null)}>Cancelar</Button>
            <Button onClick={handleSaveArticle}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor de categoria */}
      <Dialog open={!!editingCategory} onOpenChange={(o) => !o && setEditingCategory(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingCategory?.id ? 'Editar categoría' : 'Nueva categoría'}</DialogTitle></DialogHeader>
          {editingCategory && (
            <div className="space-y-3">
              <div>
                <Label>Nombre</Label>
                <Input value={editingCategory.name || ''} onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })} />
              </div>
              <div>
                <Label>Descripción</Label>
                <Textarea rows={2} value={editingCategory.description || ''} onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Icono (Lucide)</Label>
                  <Input value={editingCategory.icon || ''} placeholder="BookOpen" onChange={(e) => setEditingCategory({ ...editingCategory, icon: e.target.value })} />
                </div>
                <div>
                  <Label>Orden</Label>
                  <Input type="number" value={editingCategory.display_order ?? 0} onChange={(e) => setEditingCategory({ ...editingCategory, display_order: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={!!editingCategory.is_active} onCheckedChange={(v) => setEditingCategory({ ...editingCategory, is_active: v })} />
                <Label>Categoría ativa</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingCategory(null)}>Cancelar</Button>
            <Button onClick={handleSaveCategory}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
