import { useState } from 'react';
import { 
  ArrowLeft, 
  Building2,
  Users,
  Package,
  CreditCard,
  FileText,
  Mail,
  Phone,
  Calendar,
  Ban,
  CheckCircle,
  UserPlus,
  Clock,
  Copy,
  Check,
  MoreHorizontal,
  Link,
  Send,
  Trash2,
  UserCog,
  KeyRound,
  MailCheck,
  AtSign
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  useOrganizationDetails, 
  useBillingHistory, 
  useUpdateOrganization,
  useCreateOrganizationInvitation,
  useOrganizationInvitations,
  useDeleteOrganizationInvitation,
  useResendOrganizationInvitation,
  useUpdateUserRole,
  useRemoveUserFromOrganization,
  useDeleteOrganization
} from '@/hooks/useSuperAdmin';
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { getPublicAppUrl } from '@/lib/publicUrl';

interface OrganizationDetailPageProps {
  orgId: string;
  onBack: () => void;
}

export function OrganizationDetailPage({ orgId, onBack }: OrganizationDetailPageProps) {
  const { fecha: org, isLoading } = useOrganizationDetails(orgId);
  const { fecha: billingHistory } = useBillingHistory(orgId);
  const { fecha: pendingInvitations } = useOrganizationInvitations(orgId);
  const updateOrganization = useUpdateOrganization();
  const createInvitation = useCreateOrganizationInvitation();
  const deleteInvitation = useDeleteOrganizationInvitation();
  const resendInvitation = useResendOrganizationInvitation();
  const updateUserRole = useUpdateUserRole();
  const removeUserFromOrg = useRemoveUserFromOrganization();
  const deleteOrganization = useDeleteOrganization();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  const [isInviting, setIsInviting] = useState(false);
  const [inviteData, setInviteData] = useState({
    email: '',
    role: 'seller' as 'admin' | 'manager' | 'seller',
  });
  const [createdInvite, setCreatedInvite] = useState<{ token: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteToDelete, setInviteToDelete] = useState<{ id: string; email: string } | null>(null);
  const [userToEdit, setUserToEdit] = useState<any>(null);
  const [userToRemove, setUserToRemove] = useState<any>(null);
  const [newRole, setNewRole] = useState<'admin' | 'manager' | 'seller'>('seller');
  const [userToManage, setUserToManage] = useState<any>(null);
  const [manageAction, setManageAction] = useState<'set_password' | 'change_email' | 'confirm_email' | null>(null);
  const [manageInput, setManageInput] = useState('');
  const [managing, setManaging] = useState(false);

  const inviteLink = createdInvite 
    ? `${getPublicAppUrl()}/aceitar-convite?token=${createdInvite.token}`
    : '';

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('¡Enlace copiado!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseInviteModal = () => {
    setIsInviting(false);
    setInviteData({ email: '', role: 'seller' });
    setCreatedInvite(null);
    setCopied(false);
  };

  const copyInviteLink = async (token: string) => {
    const link = `${getPublicAppUrl()}/aceitar-convite?token=${token}`;
    await navigator.clipboard.writeText(link);
    toast.success('¡Enlace copiado!');
  };

  const handleResendInvite = async (invite: any) => {
    try {
      await resendInvitation.mutateAsync({
        invitation: invite,
        organizationName: org?.name || '',
      });
      toast.success('¡Invitación reenviada!');
    } catch (error) {
      toast.error('Error al reenviar la invitación');
    }
  };

  const handleDeleteInvite = async () => {
    if (!inviteToDelete) return;
    try {
      await deleteInvitation.mutateAsync({
        invitationId: inviteToDelete.id,
        organizationId: orgId,
      });
      toast.success('¡Invitación eliminada!');
      setInviteToDelete(null);
    } catch (error) {
      toast.error('Error al eliminar la invitación');
    }
  };

  const handleEditRole = (user: any) => {
    setUserToEdit(user);
    setNewRole(user.user_roles?.[0]?.role || 'seller');
  };

  const handleSaveRole = async () => {
    if (!userToEdit) return;
    try {
      await updateUserRole.mutateAsync({
        userId: userToEdit.id,
        oldRole: userToEdit.user_roles?.[0]?.role || null,
        newRole,
      });
      toast.success('Rol actualizado com éxito!');
      setUserToEdit(null);
    } catch (error) {
      toast.error('Error al actualizar el rol');
    }
  };

  const handleRemoveUser = async () => {
    if (!userToRemove) return;
    try {
      await removeUserFromOrg.mutateAsync({ userId: userToRemove.id });
      toast.success('¡Usuario eliminado de la empresa!');
      setUserToRemove(null);
    } catch (error) {
      toast.error('Error al eliminar al usuario');
    }
  };

  const copyUserId = async (userId: string) => {
    await navigator.clipboard.writeText(userId);
    toast.success('¡ID copiado!');
  };

  const openManageModal = (user: any, action: 'set_password' | 'change_email' | 'confirm_email') => {
    setUserToManage(user);
    setManageAction(action);
    setManageInput(action === 'change_email' ? user.email || '' : '');
  };

  const closeManageModal = () => {
    setUserToManage(null);
    setManageAction(null);
    setManageInput('');
    setManaging(false);
  };

  const handleManageUser = async () => {
    if (!userToManage || !manageAction) return;
    setManaging(true);
    try {
      const payload: any = { action: manageAction, user_id: userToManage.id };
      if (manageAction === 'set_password') payload.password = manageInput;
      if (manageAction === 'change_email') payload.email = manageInput.trim().toLowerCase();

      const { fecha, error } = await supabase.functions.invoke('super-admin-manage-user', { body: payload });
      // Tenta extrair mensaje amigável do corpo de error (FunctionsHttpError)
      let bodyError: string | null = null;
      if (error && (error as any).context?.json) {
        try {
          const parsed = await (error as any).context.json();
          bodyError = parsed?.error || null;
        } catch {
          try {
            const text = await (error as any).context.text();
            const parsed = JSON.parse(text);
            bodyError = parsed?.error || null;
          } catch {}
        }
      }
      if (bodyError) throw new Error(bodyError);
      if (error) throw error;
      if (fecha?.error) throw new Error(fecha.error);

      const msgs: Record<string, string> = {
        confirm_email: '¡Correo electrónico confirmado con éxito!',
        set_password: '¡Contraseña restablecida con éxito!',
        change_email: '¡Correo electrónico cambiado con éxito!',
      };
      toast.success(msgs[manageAction]);
      closeManageModal();
    } catch (err: any) {
      toast.error(err.message || 'Error al ejecutar la acción');
      setManaging(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat( 'es' , {
      style: 'currency',
      currency: 'PYG',
    }).format(value);
  };

  const getInitials = (name: string) => {
    return name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '??';
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Admin</Badge>;
      case 'manager':
        return <Badge className="bg-violet-500/10 text-violet-500 border-violet-500/20">Gestor</Badge>;
      case 'seller':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Vendedor</Badge>;
      default:
        return <Badge variant="secondary">{role}</Badge>;
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin': return 'Admin';
      case 'manager': return 'Gestor';
      case 'seller': return 'Vendedor';
      default: return role;
    }
  };

  const handleToggleStatus = async () => {
    if (!org) return;
    
    try {
      await updateOrganization.mutateAsync({
        id: org.id,
        status: org.status === 'active' ? 'suspended' : 'active',
      });
      toast.success(org.status === 'active' ? 'Empresa suspendida' : 'Empresa reactivada');
    } catch (error) {
      toast.error('Error ao actualizar status');
    }
  };

  const handleSendInvite = async () => {
    if (!inviteData.email) {
      toast.error('Complete el correo electrónico');
      return;
    }

    try {
      const result = await createInvitation.mutateAsync({
        email: inviteData.email,
        role: inviteData.role,
        organizationId: orgId,
      });
      setCreatedInvite({ token: result.token, email: inviteData.email });
      toast.success('¡Invitación creada con éxito!');
    } catch (error: any) {
      toast.error(error.message || 'Error al enviar la invitación');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="text-center py-12">
        <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Empresa no encontrada</p>
        <Button variant="outline" onClick={onBack} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
      </div>
    );
  }

  const subscription = org.subscriptions?.[0];
  // Fonte primária do plan: organizations + platform_plans (join). Fallback legado: subscriptions[0].
  const plan = (org as any).platform_plans ?? null;
  const planMonthly = Number(plan?.price_monthly ?? subscription?.price_monthly ?? 0);
  const planActivatedAt = (org as any).plan_activated_at ?? null;
  const caktoSubId = (org as any).cakto_subscription_id ?? null;
  const planStatus = (org as any).plan_status ?? subscription?.status ?? null;
  const hasPlan = !!plan || !!planStatus || !!subscription;
  const mrr = planStatus === 'active' ? planMonthly : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{org.name}</h1>
            <p className="text-muted-foreground">{org.cnpj || 'Sin CNPJ'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant={org.status === 'active' ? 'destructive' : 'default'}
            onClick={handleToggleStatus}
            disabled={updateOrganization.isPending}
          >
            {org.status === 'active' ? (
              <>
                <Ban className="h-4 w-4 mr-2" />
                Suspender
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Reactivar
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => { setIsDeleting(true); setDeleteConfirmName(''); }}
            title="Eliminar empresa"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Eliminar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Visión General</TabsTrigger>
          <TabsTrigger value="users">Usuarios</TabsTrigger>
          <TabsTrigger value="subscription">Suscripción</TabsTrigger>
          <TabsTrigger value="billing">Facturación</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Información de la Empresa</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Nombre:</span>
                  <span className="font-medium">{org.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Correo electrónico:</span>
                  <span className="font-medium">{org.email || 'No informado'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Teléfono:</span>
                  <span className="font-medium">{org.phone || 'No informado'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Creado el:</span>
                  <span className="font-medium">
                    {format(new Date(org.created_at), "dd/MM/yyyy", { locale: es })}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">Estado:</span>
                  <Badge className={
                    org.status === 'active' 
                      ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                  }>
                    {org.status === 'active' ? 'Activo' : org.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Métricas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <CreditCard className="h-5 w-5 text-primary" />
                    <span>MRR</span>
                  </div>
                  <span className="font-bold">
                    {formatCurrency(mrr)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-blue-500" />
                    <span>Usuarios</span>
                  </div>
                  <span className="font-bold">
                    {org.profiles?.length || 0} / {org.max_users || 10}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-violet-500" />
                    <span>Productos</span>
                  </div>
                  <span className="font-bold">
                    - / {org.max_products || 5}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Users */}
        <TabsContent value="users">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Usuarios da Empresa</CardTitle>
                <CardDescription>
                  {org.profiles?.length || 0} usuarios{pendingInvitations?.length ? ` | ${pendingInvitations.length} invitación(es) pendiente(s)` : ''}
                </CardDescription>
              </div>
              <Button onClick={() => setIsInviting(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                Agregar Usuario
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Usuarios existentes */}
              {!org.profiles?.length ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhum usuario cadastrado
                </p>
              ) : (
                <div className="space-y-3">
                  {org.profiles.map((user: any) => (
                    <div 
                      key={user.id}
                      className="flex items-center justify-between p-3 border border-border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={user.avatar_url} />
                          <AvatarFallback>{getInitials(user.full_name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{user.full_name || 'Sem nombre'}</p>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {user.user_roles?.[0]?.role && getRoleBadge(user.user_roles[0].role)}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditRole(user)}>
                              <UserCog className="h-4 w-4 mr-2" />
                              Alterar Rol
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => copyUserId(user.id)}>
                              <Copy className="h-4 w-4 mr-2" />
                              Copiar ID
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openManageModal(user, 'confirm_email')}>
                              <MailCheck className="h-4 w-4 mr-2" />
                              Validar Email
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openManageModal(user, 'set_password')}>
                              <KeyRound className="h-4 w-4 mr-2" />
                              Redefinir Contraseña
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openManageModal(user, 'change_email')}>
                              <AtSign className="h-4 w-4 mr-2" />
                              Alterar Email
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => setUserToRemove(user)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remover da Empresa
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Convites pendentes */}
              {pendingInvitations && pendingInvitations.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Convites Pendentes
                  </h4>
                  {pendingInvitations.map((invite: any) => (
                    <div 
                      key={invite.id}
                      className="flex items-center justify-between p-3 border border-dashed border-border rounded-lg bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium">{invite.email}</p>
                          <p className="text-sm text-muted-foreground">
                            Expira: {format(new Date(invite.expires_at), "dd/MM/yyyy", { locale: es })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getRoleBadge(invite.role)}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => copyInviteLink(invite.token)}>
                              <Link className="h-4 w-4 mr-2" />
                              Copiar Link
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleResendInvite(invite)}>
                              <Send className="h-4 w-4 mr-2" />
                              Reenviar Email
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => setInviteToDelete({ id: invite.id, email: invite.email })}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Eliminar Convite
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Modal de Convite */}
          <Dialog open={isInviting} onOpenChange={handleCloseInviteModal}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {createdInvite ? 'Convite Criado' : 'Agregar Usuario'}
                </DialogTitle>
              </DialogHeader>
              
              {!createdInvite ? (
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email *</Label>
                    <Input 
                      id="invite-email"
                      type="email"
                      placeholder="usuario@empresa.com"
                      value={inviteData.email}
                      onChange={(e) => setInviteData(prev => ({ ...prev, email: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Rol *</Label>
                    <Select 
                      value={inviteData.role} 
                      onValueChange={(value: 'admin' | 'manager' | 'seller') => setInviteData(prev => ({ ...prev, role: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seller">🔵 Vendedor</SelectItem>
                        <SelectItem value="manager">🟣 Gestor</SelectItem>
                        <SelectItem value="admin">🔴 Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Um convite será enviado para o email
                  </p>
                </div>
              ) : (
                <div className="space-y-4 py-4">
                  <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                    <p className="text-sm text-muted-foreground mb-2">
                      Compartilhe este link com <strong>{createdInvite.email}</strong>:
                    </p>
                    <div className="flex items-center gap-2">
                      <Input 
                        value={inviteLink} 
                        readOnly 
                        className="text-xs bg-background"
                      />
                      <Button size="icon" variant="outline" onClick={copyLink}>
                        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground text-center">
                    O convite expira em 7 días
                  </p>
                </div>
              )}
              
              <DialogFooter>
                {!createdInvite ? (
                  <>
                    <Button variant="outline" onClick={handleCloseInviteModal}>
                      Cancelar
                    </Button>
                    <Button 
                      onClick={handleSendInvite}
                      disabled={createInvitation.isPending}
                    >
                      {createInvitation.isPending ? 'Criando...' : 'Criar Convite'}
                    </Button>
                  </>
                ) : (
                  <Button onClick={handleCloseInviteModal} className="w-full">
                    Fechar
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Alert de Exclusão de Convite */}
          <AlertDialog open={!!inviteToDelete} onOpenChange={() => setInviteToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Eliminar Convite</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que desea eliminar o convite para <strong>{inviteToDelete?.email}</strong>? Esta acción no puede ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleDeleteInvite}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Modal de Alterar Rol */}
          <Dialog open={!!userToEdit} onOpenChange={() => setUserToEdit(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Alterar Rol</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <Avatar>
                    <AvatarImage src={userToEdit?.avatar_url} />
                    <AvatarFallback>{getInitials(userToEdit?.full_name || '')}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{userToEdit?.full_name || 'Sem nombre'}</p>
                    <p className="text-sm text-muted-foreground">{userToEdit?.email}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Novo Rol</Label>
                  <Select 
                    value={newRole} 
                    onValueChange={(value: 'admin' | 'manager' | 'seller') => setNewRole(value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seller">🔵 Vendedor</SelectItem>
                      <SelectItem value="manager">🟣 Gestor</SelectItem>
                      <SelectItem value="admin">🔴 Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUserToEdit(null)}>
                  Cancelar
                </Button>
                <Button 
                  onClick={handleSaveRole}
                  disabled={updateUserRole.isPending}
                >
                  {updateUserRole.isPending ? 'Salvando...' : 'Salvar'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Alert de Remoção de Usuario */}
          <AlertDialog open={!!userToRemove} onOpenChange={() => setUserToRemove(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover Usuario</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que desea eliminar <strong>{userToRemove?.full_name || userToRemove?.email}</strong> de la empresa? O usuario perderá acesso e sus papéis serão removidos.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleRemoveUser}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Modal de Gerenciamento de Cuenta (validar email / contraseña / email) */}
          <Dialog open={!!userToManage} onOpenChange={(o) => !o && closeManageModal()}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {manageAction === 'confirm_email' && 'Validar Email'}
                  {manageAction === 'set_password' && 'Redefinir Contraseña'}
                  {manageAction === 'change_email' && 'Alterar Email'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <Avatar>
                    <AvatarImage src={userToManage?.avatar_url} />
                    <AvatarFallback>{getInitials(userToManage?.full_name || '')}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{userToManage?.full_name || 'Sem nombre'}</p>
                    <p className="text-sm text-muted-foreground">{userToManage?.email}</p>
                  </div>
                </div>

                {manageAction === 'confirm_email' && (
                  <p className="text-sm text-muted-foreground">
                    Confirmar manualmente o email deste usuario, dispensando a verificação por link. Usa cuando o usuario no recebeu ou perdeu o email de validação.
                  </p>
                )}

                {manageAction === 'set_password' && (
                  <div className="space-y-2">
                    <Label>Nova Contraseña</Label>
                    <Input
                      type="text"
                      value={manageInput}
                      onChange={(e) => setManageInput(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      Informe a nova contraseña. O usuario poderá trocá-la después em Perfil → Trocar contraseña.
                    </p>
                  </div>
                )}

                {manageAction === 'change_email' && (
                  <div className="space-y-2">
                    <Label>Novo Email</Label>
                    <Input
                      type="email"
                      value={manageInput}
                      onChange={(e) => setManageInput(e.target.value)}
                      placeholder="novo@email.com"
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      O email será alterado e marcado como confirmado automaticamente.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeManageModal} disabled={managing}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleManageUser}
                  disabled={
                    managing ||
                    (manageAction === 'set_password' && manageInput.length < 8) ||
                    (manageAction === 'change_email' && !manageInput.includes('@'))
                  }
                >
                  {managing ? 'Aplicando...' : 'Confirmar'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Subscription */}
        <TabsContent value="subscription">
          <Card>
            <CardHeader>
              <CardTitle>Suscripción Atual</CardTitle>
            </CardHeader>
            <CardContent>
              {!hasPlan ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhum plan ativo
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div>
                      <p className="text-sm text-muted-foreground">Plano</p>
                      <p className="text-xl font-bold capitalize">
                        {plan?.name ?? subscription?.plan_type ?? '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Valor</p>
                      <p className="text-xl font-bold">
                        {formatCurrency(planMonthly)}/mes
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 border border-border rounded-lg">
                      <p className="text-sm text-muted-foreground">Status</p>
                      <Badge className={
                        planStatus === 'active'
                          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 mt-1'
                          : 'bg-amber-500/10 text-amber-500 border-amber-500/20 mt-1'
                      }>
                        {planStatus === 'active' ? 'Activo' : (planStatus ?? '—')}
                      </Badge>
                    </div>
                    <div className="p-4 border border-border rounded-lg">
                      <p className="text-sm text-muted-foreground">Ativado em</p>
                      <p className="font-medium mt-1">
                        {planActivatedAt
                          ? format(new Date(planActivatedAt), "dd/MM/yyyy", { locale: es })
                          : (subscription?.current_period_end
                              ? format(new Date(subscription.current_period_end), "dd/MM/yyyy", { locale: es })
                              : '-')
                        }
                      </p>
                    </div>
                    {caktoSubId && (
                      <div className="p-4 border border-border rounded-lg col-span-2">
                        <p className="text-sm text-muted-foreground">ID Cakto</p>
                        <p className="font-mono text-xs mt-1 break-all">{caktoSubId}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing */}
        <TabsContent value="billing">
          <Card>
            <CardHeader>
              <CardTitle>Histórico de Facturación</CardTitle>
            </CardHeader>
            <CardContent>
              {!billingHistory?.length ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhuma cobro registrada
                </p>
              ) : (
                <div className="space-y-3">
                  {billingHistory.map((bill: any) => (
                    <div 
                      key={bill.id}
                      className="flex items-center justify-between p-3 border border-border rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{bill.description || 'Mensalidade'}</p>
                        <p className="text-sm text-muted-foreground">
                          {bill.due_date 
                            ? format(new Date(bill.due_date), "dd/MM/yyyy", { locale: es })
                            : '-'
                          }
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{formatCurrency(bill.amount)}</p>
                        <Badge variant={bill.status === 'paid' ? 'default' : 'secondary'}>
                          {bill.status === 'paid' ? 'Pago' : bill.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={isDeleting} onOpenChange={(open) => { if (!open) { setIsDeleting(false); setDeleteConfirmName(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar empresa permanentemente</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-destructive font-medium">
                  Esta acción é irreversível. Todos os dados (usuarios, leads, conversaciones, productos, integraciones) serão removidos.
                </p>
                <p>Para confirmar, digite o nombre exato: <strong>{org.name}</strong></p>
                <Input
                  autoFocus
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={org.name}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirmName !== org.name || deleteOrganization.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await deleteOrganization.mutateAsync(org.id);
                  toast.success(`Empresa "${org.name}" excluída`);
                  onBack();
                } catch (err: any) {
                  toast.error(err?.message || 'Error ao eliminar empresa');
                }
              }}
            >
              {deleteOrganization.isPending ? 'Excluindo...' : 'Eliminar permanentemente'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
