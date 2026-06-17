import { useState } from 'react';
import { useProducts } from '@/hooks/useProducts';
import { useCreateMaterial, useUpdateMaterial, useDeleteMaterial } from '@/hooks/useMaterials';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Pencil, Trash2, FileText, Video, Image, File, Link2, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Tables } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

type Material = Tables<'materials'>;

const typeConfig = {
  document: { label: 'Documento', icon: FileText, color: 'bg-blue-500/10 text-blue-600' },
  video: { label: 'Video', icon: Video, color: 'bg-red-500/10 text-red-600' },
  image: { label: 'Imagen', icon: Image, color: 'bg-emerald-500/10 text-emerald-600' },
  link: { label: 'Link', icon: Link2, color: 'bg-violet-500/10 text-violet-600' },
  other: { label: 'Otro', icon: File, color: 'bg-muted text-muted-foreground' },
};

export function MaterialManager() {
  const { profile } = useAuth();
  const { data: products } = useProducts();
  
  // Usa raw DB query for admin to get full material data
  const { data: materials, isLoading } = useQuery({
    queryKey: ['materials-admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('materials')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Material[];
    },
  });
  
  const createMaterial = useCreateMaterial();
  const updateMaterial = useUpdateMaterial();
  const deleteMaterial = useDeleteMaterial();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string>('all');
  
  const [formData, setFormData] = useState({
    name: '',
    type: 'document',
    url: '',
    objective: '',
    tags: '',
    product_id: '',
    status: 'active',
  });

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'document',
      url: '',
      objective: '',
      tags: '',
      product_id: '',
      status: 'active',
    });
    setEditingMaterial(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (material: Material) => {
    setEditingMaterial(material);
    setFormData({
      name: material.name,
      type: material.type,
      url: material.url,
      objective: material.objective || '',
      tags: (material.tags || []).join(', '),
      product_id: material.product_id || '',
      status: material.status || 'active',
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.url.trim()) {
      toast.error('Nombre e URL son obligatorios');
      return;
    }

    const materialData = {
      name: formData.name,
      type: formData.type,
      url: formData.url,
      objective: formData.objective || null,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      product_id: formData.product_id || null,
      organization_id: profile?.organization_id || null,
      status: formData.status,
    };

    try {
      if (editingMaterial) {
        await updateMaterial.mutateAsync({ id: editingMaterial.id, ...materialData });
        toast.success('¡Material actualizado!');
      } else {
        await createMaterial.mutateAsync(materialData);
        toast.success('¡Material creado!');
      }
      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      toast.error('Error ao guardar material');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMaterial.mutateAsync(id);
      toast.success('¡Material eliminado!');
    } catch (error) {
      toast.error('Error ao eliminar material');
    }
  };

  const filteredMaterials = materials?.filter(m => 
    selectedProduct === 'all' || m.product_id === selectedProduct || (!m.product_id && selectedProduct === 'global')
  ) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Materiales</h2>
          <p className="text-sm text-muted-foreground">
            Gestione documentos, videos y enlaces de apoyo
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Material
        </Button>
      </div>

      <Tabs value={selectedProduct} onValueChange={setSelectedProduct}>
        <TabsList>
          <TabsTrigger value="all">Todos</TabsTrigger>
          <TabsTrigger value="global">Globales</TabsTrigger>
          {products?.map(p => (
            <TabsTrigger key={p.id} value={p.id}>{p.name}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredMaterials.map((material) => {
          const config = typeConfig[material.type as keyof typeof typeConfig] || typeConfig.other;
          const Icon = config.icon;
          const product = products?.find(p => p.id === material.product_id);
          
          return (
            <Card key={material.id} className="bg-card group">
              <CardContent className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className={`h-10 w-10 rounded-lg ${config.color} flex items-center justify-center`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate">{material.name}</h3>
                    <p className="text-xs text-muted-foreground">{config.label}</p>
                  </div>
                </div>

                {material.objective && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {material.objective}
                  </p>
                )}

                <div className="flex flex-wrap gap-1 mb-3">
                  {product && (
                    <Badge variant="outline" className="text-xs">
                      {product.name}
                    </Badge>
                  )}
                  {material.tags?.slice(0, 2).map(tag => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => window.open(material.url, '_blank')}
                  >
                    <ExternalLink className="mr-1 h-3 w-3" />
                    Abrir
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEditDialog(material)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Eliminar material?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta acción no puede ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(material.id)}
                          className="bg-destructive text-destructive-foreground"
                        >
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filteredMaterials.length === 0 && (
          <Card className="col-span-full bg-card">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-1">Ningún material</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Añada documentos, videos y enlaces
              </p>
              <Button onClick={openCreateDialog}>
                <Plus className="mr-2 h-4 w-4" />
                Añadir Material
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialog de Crear/Editar */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingMaterial ? 'Editar Material' : 'Nuevo Material'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Case de éxito - Empresa X"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={formData.type}
                  onValueChange={(v) => setFormData({ ...formData, type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <config.icon className="h-4 w-4" />
                          {config.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Producto (opcional)</Label>
                <Select
                  value={formData.product_id}
                  onValueChange={(v) => setFormData({ ...formData, product_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Global (todos)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Global (todos)</SelectItem>
                    {products?.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="url">URL *</Label>
              <Input
                id="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="objective">Objetivo / Cuando usar</Label>
              <Textarea
                id="objective"
                value={formData.objective}
                onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
                placeholder="Descreva cuando usar este material..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Etiquetas (separadas por coma)</Label>
              <Input
                id="tags"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="case, roi, enterprise"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={createMaterial.isPending || updateMaterial.isPending}>
              {(createMaterial.isPending || updateMaterial.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editingMaterial ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
