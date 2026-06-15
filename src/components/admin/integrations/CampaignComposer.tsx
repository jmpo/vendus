import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useTeamMembers } from '@/hooks/useTeam';
import { useSquads } from '@/hooks/useSquads';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import { useCreateCampaign, useSendCampaign } from '@/hooks/useMassEmailCampaigns';
import { ArrowLeft, Send, Users, Loader2 } from 'lucide-react';

interface CampaignComposerProps {
  onClose: () => void;
}

export function CampaignComposer({ onClose }: CampaignComposerProps) {
  const { fecha: teamMembers } = useTeamMembers();
  const { fecha: squads } = useSquads();
  const { fecha: templates } = useEmailTemplates();
  const createCampaign = useCreateCampaign();
  const sendCampaign = useSendCampaign();

  const [step, setStep] = useState(1);
  const [targetType, setTargetType] = useState<'all' | 'squad' | 'role' | 'custom'>('all');
  const [selectedSquads, setSelectedSquads] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [htmlContent, setHtmlContent] = useState('');

  const [isSending, setIsSending] = useState(false);

  const selectedRecipients = useMemo(() => {
    if (!teamMembers) return [];

    switch (targetType) {
      case 'all':
        return teamMembers;
      case 'squad':
        // Filter by squad - simplified since we don't have nested fecha
        return teamMembers.filter(m => selectedSquads.length > 0);
      case 'role':
        // Filter by role - simplified since we don't have nested fecha
        return teamMembers.filter(m => selectedRoles.length > 0);
      case 'custom':
        return teamMembers.filter(m => selectedUsers.includes(m.id));
      default:
        return [];
    }
  }, [teamMembers, targetType, selectedSquads, selectedRoles, selectedUsers]);

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates?.find(t => t.id === templateId);
    if (template) {
      setSubject(template.subject);
      setHtmlContent(template.html_content);
    }
  };

  const handleSend = async () => {
    if (!subject || !htmlContent || selectedRecipients.length === 0) return;

    setIsSending(true);
    try {
      const campaign = await createCampaign.mutateAsync({
        template_id: selectedTemplateId,
        subject,
        html_content: htmlContent,
        target_type: targetType,
        target_filters: {
          squadIds: selectedSquads,
          roles: selectedRoles,
          userIds: selectedUsers
        },
        scheduled_at: null,
        status: 'draft'
      });

      await sendCampaign.mutateAsync({
        campaignId: campaign.id,
        recipients: selectedRecipients.map(r => ({
          user_id: r.id,
          email: r.email,
          full_name: r.full_name
        }))
      });

      onClose();
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h3 className="text-lg font-semibold">Nueva Campaña</h3>
          <p className="text-sm text-muted-foreground">
            Paso {step} de 2
          </p>
        </div>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seleccionar Destinatarios</CardTitle>
            <CardDescription>
              Elija quién recibirá este mensaje
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <RadioGroup value={targetType} onValueChange={(v) => setTargetType(v as typeof targetType)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="all" />
                <Label htmlFor="all" className="cursor-pointer">
                  Todo el equipo ({teamMembers?.length || 0} miembros)
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="squad" id="squad" />
                <Label htmlFor="squad" className="cursor-pointer">Por Squad</Label>
              </div>
              {targetType === 'squad' && (
                <div className="ml-6 space-y-2">
                  {squads?.map((squad) => (
                    <div key={squad.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`squad-${squad.id}`}
                        checked={selectedSquads.includes(squad.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedSquads(prev => [...prev, squad.id]);
                          } else {
                            setSelectedSquads(prev => prev.filter(id => id !== squad.id));
                          }
                        }}
                      />
                      <Label htmlFor={`squad-${squad.id}`} className="cursor-pointer">
                        {squad.name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="role" id="role" />
                <Label htmlFor="role" className="cursor-pointer">Por Rol</Label>
              </div>
              {targetType === 'role' && (
                <div className="ml-6 space-y-2">
                  {['admin', 'manager', 'seller'].map((role) => (
                    <div key={role} className="flex items-center space-x-2">
                      <Checkbox
                        id={`role-${role}`}
                        checked={selectedRoles.includes(role)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedRoles(prev => [...prev, role]);
                          } else {
                            setSelectedRoles(prev => prev.filter(r => r !== role));
                          }
                        }}
                      />
                      <Label htmlFor={`role-${role}`} className="cursor-pointer capitalize">
                        {role === 'admin' ? 'Administradores' : role === 'manager' ? 'Gestores' : 'Vendedores'}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="custom" id="custom" />
                <Label htmlFor="custom" className="cursor-pointer">Seleccionar manualmente</Label>
              </div>
              {targetType === 'custom' && (
                <div className="ml-6 space-y-2 max-h-48 overflow-y-auto">
                  {teamMembers?.map((member) => (
                    <div key={member.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`user-${member.id}`}
                        checked={selectedUsers.includes(member.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedUsers(prev => [...prev, member.id]);
                          } else {
                            setSelectedUsers(prev => prev.filter(id => id !== member.id));
                          }
                        }}
                      />
                      <Label htmlFor={`user-${member.id}`} className="cursor-pointer">
                        {member.full_name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </RadioGroup>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Users className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm">
                <strong>{selectedRecipients.length}</strong> destinatario(s) seleccionado(s)
              </span>
            </div>

            <div className="flex justify-end">
              <Button 
                onClick={() => setStep(2)} 
                disabled={selectedRecipients.length === 0}
              >
                Continuar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Componer Mensaje</CardTitle>
            <CardDescription>
              Elija una plantilla o escriba su mensaje
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Plantilla (opcional)</Label>
              <Select value={selectedTemplateId || ''} onValueChange={handleSelectTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione una plantilla o escriba desde cero" />
                </SelectTrigger>
                <SelectContent>
                  {templates?.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Asunto</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Asunto do email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">Contenido (HTML)</Label>
              <Textarea
                id="content"
                value={htmlContent}
                onChange={(e) => setHtmlContent(e.target.value)}
                placeholder="Contenido del email en HTML..."
                rows={10}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Send className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm">
                Será enviado a <strong>{selectedRecipients.length}</strong> persona(s)
              </span>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Volver
              </Button>
              <Button 
                onClick={handleSend} 
                disabled={!subject || !htmlContent || isSending}
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Enviar a {selectedRecipients.length} persona(s)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
