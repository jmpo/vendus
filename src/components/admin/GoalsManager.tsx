import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSalesGoals, useCreateSalesGoal, useUpdateSalesGoal } from '@/hooks/useSalesGoals';
import { useProducts } from '@/hooks/useProducts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Plus, 
  Target, 
  Loader2,
  Calendar,
  User,
  Edit,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface TeamMember {
  id: string;
  full_name: string;
}

interface GoalsManagerProps {
  teamMembers: TeamMember[];
}

export function GoalsManager({ teamMembers }: GoalsManagerProps) {
  const { profile } = useAuth();
  const { data: goals, isLoading } = useSalesGoals();
  const { data: products } = useProducts();
  const createGoal = useCreateSalesGoal();
  const updateGoal = useUpdateSalesGoal();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    user_id: '',
    product_id: '',
    period_start: '',
    period_end: '',
    target_value: 0,
    target_deals: 0
  });

  const resetForm = () => {
    setFormData({
      user_id: '',
      product_id: '',
      period_start: '',
      period_end: '',
      target_value: 0,
      target_deals: 0
    });
  };

  const handleSubmit = async () => {
    if (!formData.user_id || !formData.period_start || !formData.period_end) {
      toast.error('Complete todos los campos obligatorios');
      return;
    }

    try {
      await createGoal.mutateAsync({
        user_id: formData.user_id,
        product_id: formData.product_id || null,
        organization_id: profile?.organization_id || null,
        period_start: formData.period_start,
        period_end: formData.period_end,
        target_value: formData.target_value,
        target_deals: formData.target_deals,
        is_active: true,
        created_by: profile?.id || null
      });
      toast.success('¡Meta creada con éxito!');
      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      toast.error('Error al crear meta');
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-PY', {
      style: 'currency',
      currency: 'PYG',
      minimumFractionDigits: 0
    }).format(value);
  };

  const getUserName = (userId: string) => {
    return teamMembers.find(m => m.id === userId)?.full_name || 'Usuario';
  };

  const getProductName = (productId: string | null) => {
    if (!productId) return 'Todos los productos';
    return products?.find(p => p.id === productId)?.name || 'Producto';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Gestión de Metas</h2>
          <p className="text-muted-foreground">
            Defina metas de ventas para su equipo
          </p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus size={18} className="mr-2" />
              Nueva Meta
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear Meta de Ventas</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Vendedor *</label>
                <Select 
                  value={formData.user_id} 
                  onValueChange={(value) => setFormData({ ...formData, user_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione el vendedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers.map(member => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Producto (opcional)</label>
                <Select 
                  value={formData.product_id} 
                  onValueChange={(value) => setFormData({ ...formData, product_id: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Todos los productos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Todos los productos</SelectItem>
                    {products?.map(product => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Inicio del Período *</label>
                  <Input
                    type="date"
                    value={formData.period_start}
                    onChange={(e) => setFormData({ ...formData, period_start: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Fin del Período *</label>
                  <Input
                    type="date"
                    value={formData.period_end}
                    onChange={(e) => setFormData({ ...formData, period_end: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Meta de Valor (R$)</label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={formData.target_value || ''}
                    onChange={(e) => setFormData({ ...formData, target_value: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Meta de Deals</label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={formData.target_deals || ''}
                    onChange={(e) => setFormData({ ...formData, target_deals: Number(e.target.value) })}
                  />
                </div>
              </div>

              <Button 
                className="w-full" 
                onClick={handleSubmit}
                disabled={createGoal.isPending}
              >
                {createGoal.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Crear Meta'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Goals Table */}
      {goals && goals.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendedor</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Meta Valor</TableHead>
                <TableHead>Meta Deals</TableHead>
                <TableHead>Progreso</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {goals.map((goal) => {
                const valueProgress = goal.target_value > 0 
                  ? ((goal.achieved_value || 0) / goal.target_value) * 100
                  : 0;
                const isActive = new Date(goal.period_end) >= new Date();
                
                return (
                  <TableRow key={goal.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-muted-foreground" />
                        {getUserName(goal.user_id)}
                      </div>
                    </TableCell>
                    <TableCell>{getProductName(goal.product_id)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm">
                        <Calendar size={12} className="text-muted-foreground" />
                        {format(new Date(goal.period_start), "dd/MM", { locale: es })} - {format(new Date(goal.period_end), "dd/MM/yy", { locale: es })}
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(goal.target_value)}</TableCell>
                    <TableCell>{goal.target_deals} deals</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-secondary rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.min(100, valueProgress)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {valueProgress.toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {valueProgress >= 100 ? (
                        <Badge className="bg-green-500">Alcanzada</Badge>
                      ) : isActive ? (
                        <Badge variant="secondary">En progreso</Badge>
                      ) : (
                        <Badge variant="outline">Cerrada</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <Target className="h-16 w-16 text-muted-foreground/40 mb-4" />
            <h3 className="text-xl font-semibold text-foreground mb-2">
              Ninguna meta definida
            </h3>
            <p className="text-muted-foreground mb-6 max-w-md">
              Cree metas para que su equipo siga el desempeño y mantenga la motivación.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus size={18} className="mr-2" />
              Crear Primera Meta
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
