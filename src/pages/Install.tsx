import { Smartphone, Share, Plus, Download, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePWA } from '@/hooks/usePWA';

export default function Install() {
  const { isInstalled, isInstallable, isIOS, promptInstall } = usePWA();

  if (isInstalled) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full p-8 text-center">
          <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">¡App instalada!</h1>
          <p className="text-muted-foreground">SalesOS ya está instalado en tu dispositivo.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center py-8">
          <div className="h-20 w-20 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <Smartphone size={40} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Instalá SalesOS</h1>
          <p className="text-muted-foreground">Accedé a tus ventas directo desde la pantalla de inicio</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3 p-4 bg-card rounded-lg border border-border">
            <CheckCircle size={20} className="text-green-500 shrink-0" />
            <span className="text-sm text-foreground">Acceso rápido sin abrir el navegador</span>
          </div>
          <div className="flex items-center gap-3 p-4 bg-card rounded-lg border border-border">
            <CheckCircle size={20} className="text-green-500 shrink-0" />
            <span className="text-sm text-foreground">Funciona sin conexión</span>
          </div>
          <div className="flex items-center gap-3 p-4 bg-card rounded-lg border border-border">
            <CheckCircle size={20} className="text-green-500 shrink-0" />
            <span className="text-sm text-foreground">Notificaciones de leads y tareas</span>
          </div>
        </div>

        {isInstallable && (
          <Button onClick={promptInstall} className="w-full h-12 text-base" size="lg">
            <Download size={20} className="mr-2" />
            Instalar ahora
          </Button>
        )}

        <Card className="p-4 bg-muted/50">
          <h3 className="font-semibold text-foreground mb-3">Cómo instalar manualmente:</h3>
          {isIOS ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="flex items-center gap-2"><Share size={16} /> 1. Tocá "Compartir"</p>
              <p className="flex items-center gap-2"><Plus size={16} /> 2. Seleccioná "Agregar a pantalla de inicio"</p>
              <p>3. Confirmá tocando "Agregar"</p>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>1. Abrí el menú del navegador (⋮)</p>
              <p>2. Tocá "Instalar aplicación"</p>
              <p>3. Confirmá la instalación</p>
            </div>
          )}
        </Card>

        <Button variant="outline" className="w-full" onClick={() => window.history.back()}>
          Volver
        </Button>
      </div>
    </div>
  );
}
