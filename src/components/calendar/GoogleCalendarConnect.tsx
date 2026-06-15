import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useGoogleCalendarConnection } from '@/hooks/useGoogleCalendarConnection';
import { CalendarDays, Link2, Unlink, RefreshCw, CheckCircle, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function GoogleCalendarConnect() {
  const [searchParams, setSearchParams] = useSearchParams();
  
  const {
    connection,
    isConnected,
    isLoading,
    isOAuthConfigured,
    isCheckingConfig,
    connect,
    isConnecting,
    disconnect,
    isDisconnecting,
    sync,
    isSyncing,
    updateSettings,
  } = useGoogleCalendarConnection();

  const [oauthError, setOauthError] = useState<string | null>(null);

  // Handle OAuth callback params
  useEffect(() => {
    const connected = searchParams.get('google_calendar_connected');
    const error = searchParams.get('google_calendar_error');

    if (connected === 'true') {
      toast.success('¡Google Calendar conectado con éxito!');
      setOauthError(null);
      searchParams.delete('google_calendar_connected');
      setSearchParams(searchParams, { replace: true });
    }

    if (error) {
      const decoded = decodeURIComponent(error);
      setOauthError(decoded);
      toast.error(`Error al conectar: ${decoded}`, { duration: 10000 });
      searchParams.delete('google_calendar_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (isLoading || isCheckingConfig) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // OAuth not configured by admin
  if (!isOAuthConfigured) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <CalendarDays className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Google Calendar</CardTitle>
              <CardDescription>Integración no configurada</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            El administrador debe configurar las credenciales OAuth de Google en los ajustes de Integraciones.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Not connected - show connect button
  if (!isConnected) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <CalendarDays className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Conectar Google Calendar</CardTitle>
              <CardDescription>
                Sincroniza tus citas automáticamente
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {oauthError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Fallo en el último intento</AlertTitle>
              <AlertDescription className="space-y-1">
                <p className="text-xs break-words">{oauthError}</p>
                {/invalid_client|client_secret|unauthorized_client/i.test(oauthError) && (
                  <p className="text-xs">
                    Causa probable: <strong>Client Secret incorrecto</strong>. Pide al administrador que lo revise
                    en Ajustes → Integraciones → Google Calendar (el secreto comienza con <code>GOCSPX-</code>).
                  </p>
                )}
                {/redirect_uri_mismatch/i.test(oauthError) && (
                  <p className="text-xs">
                    Causa probable: el <strong>Authorized redirect URI</strong> en Google Cloud Console no
                    coincide con el callback del proyecto.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          <ul className="text-sm space-y-1.5 text-muted-foreground">
            <li className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              Importar eventos de Google
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              Exportar reuniones a tu calendario
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              Evitar conflictos de horario
            </li>
          </ul>
          
          <Button 
            onClick={() => connect()}
            disabled={isConnecting}
            className="w-full"
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Conectar mi cuenta de Google
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Connected - show status and settings
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <CalendarDays className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                Google Calendar
                <Badge variant="outline" className="text-green-600 border-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Conectado
                </Badge>
              </CardTitle>
              <CardDescription>
                {connection?.google_email}
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0 space-y-4">
        {/* Last sync info */}
        {connection?.last_sync_at && (
          <p className="text-xs text-muted-foreground">
            Última sincronización: {formatDistanceToNow(new Date(connection.last_sync_at), { 
              addSuffix: true, 
              locale: es 
            })}
          </p>
        )}

        {/* Sync direction */}
        <div className="flex items-center justify-between">
          <span className="text-sm">Dirección de sincronización</span>
          <Select
            value={connection?.sync_direction || 'both'}
            onValueChange={(value) => updateSettings({ 
              sync_direction: value
            })}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="import">Solo importar</SelectItem>
              <SelectItem value="export">Solo exportar</SelectItem>
              <SelectItem value="both">Ambos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Sync enabled toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm">Sincronización automática</span>
          <Switch
            checked={connection?.sync_enabled ?? true}
            onCheckedChange={(checked) => updateSettings({ sync_enabled: checked })}
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => sync('both')}
            disabled={isSyncing}
            className="flex-1"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sincronizar ahora
          </Button>
          
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => disconnect()}
            disabled={isDisconnecting}
            className="text-destructive hover:text-destructive"
          >
            {isDisconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Unlink className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
