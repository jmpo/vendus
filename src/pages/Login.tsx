import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Mail, Lock, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { translateAuthError } from '@/lib/auth-errors';
import { Logo } from '@/components/ui/Logo';
import { usePlatformName } from '@/hooks/usePlatformName';

type View = 'login' | 'forgot';

export default function Login() {
  const [view, setView] = useState<View>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { platformName, loginHeadline, loginSubheadline, loginStatsEnabled, footerText, loginBgImageUrl, loginBgLayout } = usePlatformName();



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await signIn(email, password);
      if (error) {
        toast.error(translateAuthError(error.message));
      } else {
        toast.success('¡Bienvenido de vuelta!');
        navigate('/');
      }
    } catch (error) {
      toast.error('Ocurrió un error inesperado');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Ingresá tu email');
      return;
    }
    setIsLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Mensaje genérico — no expone si el email existe (anti-enumeración)
      setForgotSent(true);
    } catch {
      setForgotSent(true);
    } finally {
      setIsLoading(false);
    }
  };


  // Processar headline con quebra de línea
  const headlineParts = loginHeadline.split('\n');

  const layout = loginBgImageUrl ? loginBgLayout : 'split-left';
  const isFullscreen = layout === 'fullscreen';
  const isSplitRight = layout === 'split-right';

  return (
    <div
      className={`min-h-screen bg-background flex relative ${
        isSplitRight ? 'lg:flex-row-reverse' : ''
      }`}
      style={
        isFullscreen && loginBgImageUrl
          ? {
              backgroundImage: `url(${loginBgImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: 'hsl(var(--primary))',
            }
          : undefined
      }
    >
      {/* Overlay cuando imagen ocupa a tela toda, garante legibilidade do form */}
      {isFullscreen && loginBgImageUrl && (
        <div className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-none" />
      )}

      {/* No mobile, mostra a imagen como fundo + overlay para legibilidade do form */}
      {!isFullscreen && loginBgImageUrl && (
        <>
          <div
            className="lg:hidden absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url(${loginBgImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="lg:hidden absolute inset-0 bg-background/85 backdrop-blur-sm pointer-events-none" />
        </>
      )}

      {/* Branding lateral — oculto em layout fullscreen */}
      {!isFullscreen && (
        <div
          className="hidden lg:flex lg:w-1/2 p-12 flex-col justify-between relative overflow-hidden"
          style={
            loginBgImageUrl
              ? {
                  backgroundImage: `url(${loginBgImageUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundColor: 'hsl(var(--primary))',
                }
              : { background: 'var(--gradient-primary)' }
          }
        >
          <div className="absolute inset-0 bg-black/10" />
          <div className="relative">
            <Logo size="lg" />
          </div>

          <div className="space-y-6 relative">
            <h1 className="text-4xl font-bold text-white leading-tight drop-shadow-sm">
              {headlineParts.map((part, i) => (
                <span key={i}>
                  {part}
                  {i < headlineParts.length - 1 && <br />}
                </span>
              ))}
            </h1>
            <p className="text-lg text-white/90 max-w-md">
              {loginSubheadline}
            </p>

            {loginStatsEnabled && (
              <div className="flex gap-8 pt-8">
                <div>
                  <p className="text-3xl font-bold text-white">+40%</p>
                  <p className="text-sm text-white/80">Conversión</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-white">-50%</p>
                  <p className="text-sm text-white/80">Tiempo respuesta</p>
                </div>
                <div>
                  <p className="text-3xl font-bold text-white">15+</p>
                  <p className="text-sm text-white/80">Empresas</p>
                </div>
              </div>
            )}
          </div>

          <p className="text-sm text-white/80 relative">
            {footerText || `© ${new Date().getFullYear()} ${platformName}. Todos los derechos reservados.`}
          </p>
        </div>
      )}

      {/* Form — em fullscreen ocupa toda a largura e é centralizado em um card */}
      <div
        className={`w-full ${
          isFullscreen ? '' : 'lg:w-1/2'
        } flex items-center justify-center p-8 relative z-10`}
      >
        <div
          className={`w-full max-w-md space-y-8 ${
            isFullscreen
              ? 'bg-background/95 backdrop-blur-md rounded-2xl border border-border shadow-2xl p-8'
              : ''
          }`}
        >
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <Logo size="lg" />
          </div>

          <div className="text-center lg:text-left">
            <h2 className="text-2xl font-bold text-foreground">
              {view === 'login' ? 'Iniciar sesión' : 'Recuperar contraseña'}
            </h2>
            <p className="text-muted-foreground mt-2">
              {view === 'login'
                ? 'Ingresá tus credenciales para acceder'
                : 'Ingresá tu email y te enviaremos un enlace para restablecer tu contraseña'}
            </p>
          </div>

          {view === 'login' && (
            <>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="su@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 h-12 bg-card border-border"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 h-12 bg-card border-border"
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full h-12 text-base" disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      Ingresar
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                  )}
                </Button>
              </form>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setView('forgot');
                    setForgotSent(false);
                  }}
                  className="text-primary hover:underline text-sm"
                >
                  Olvidé mi contraseña
                </button>
              </div>
            </>
          )}

          {view === 'forgot' && (
            <>
              {forgotSent ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                    Si este email está registrado, te enviaremos un enlace de recuperación en unos instantes. Revisá tu bandeja de entrada y la carpeta de spam.
                  </div>
                  <Button
                    type="button"
                    className="w-full h-12 text-base"
                    onClick={() => {
                      setView('login');
                      setForgotSent(false);
                    }}
                  >
                    Volver al login
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        id="forgot-email"
                        type="email"
                        placeholder="tu@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10 h-12 bg-card border-border"
                        required
                      />
                    </div>
                  </div>

                  <Button type="submit" className="w-full h-12 text-base" disabled={isLoading}>
                    {isLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        Enviar enlace de recuperación
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </>
                    )}
                  </Button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setView('login')}
                      className="text-primary hover:underline text-sm"
                    >
                      Volver al login
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
