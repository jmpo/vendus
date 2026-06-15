import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useEmailConfig, useUpdateEmailConfig } from '@/hooks/useIntegrations';
import { Loader2, AlertTriangle, Save } from 'lucide-react';

export function EmailConfigManager() {
  const { data: config, isLoading } = useEmailConfig();
  const updateConfig = useUpdateEmailConfig();

  const [formData, setFormData] = useState({
    senderName: '',
    senderEmail: '',
    signature: ''
  });

  useEffect(() => {
    if (config) {
      setFormData({
        senderName: config.senderName || '',
        senderEmail: config.senderEmail || '',
        signature: config.signature || ''
      });
    }
  }, [config]);

  const handleSave = async () => {
    await updateConfig.mutateAsync(formData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Configuración de Emails</h3>
        <p className="text-sm text-muted-foreground">
          Configure el remitente predeterminado y la firma de los correos electrónicos
        </p>
      </div>

      <Alert variant="default" className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800 dark:text-amber-200">
          <strong>Dominio de prueba:</strong> Los correos electrónicos se envían con el dominio de prueba de Resend (resend.dev). 
          Para enviar con su propio dominio, verifíquelo en el panel de Resend.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Remitente</CardTitle>
          <CardDescription>
            Defina cómo aparecerán sus correos electrónicos para los destinatarios
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="senderName">Nombre do Remitente</Label>
              <Input
                id="senderName"
                placeholder="Ex: Equipo de Ventas"
                value={formData.senderName}
                onChange={(e) => setFormData(prev => ({ ...prev, senderName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senderEmail">Email de Respuesta</Label>
              <Input
                id="senderEmail"
                type="email"
                placeholder="Ex: ventas@suaempresa.com"
                value={formData.senderEmail}
                onChange={(e) => setFormData(prev => ({ ...prev, senderEmail: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Este correo electrónico se utilizará en el Reply-To de los correos enviados
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Firma Predeterminada</CardTitle>
          <CardDescription>
            Texto que se incluirá en el pie de página de los correos electrónicos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Textarea
              placeholder="Ex: Atenciosamente,&#10;Equipo de Ventas&#10;contacto@empresa.com"
              rows={4}
              value={formData.signature}
              onChange={(e) => setFormData(prev => ({ ...prev, signature: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={updateConfig.isPending}>
          {updateConfig.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Guardar Configuraciones
        </Button>
      </div>
    </div>
  );
}
