import { useState } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GuidedOnboarding } from './GuidedOnboarding';
import { useGuidedOnboarding } from '@/hooks/useGuidedOnboarding';

/**
 * Tarja amarela persistente que aparece no painel admin mientras
 * o onboarding guiado no fue concluído. O botón X solo oculta
 * a tarja na sesión actual — ela retorna em novos acessos até a
 * conclusión definitiva.
 */
export function OnboardingBanner() {
  const { shouldShow, markCompleted } = useGuidedOnboarding();
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  const [openWizard, setOpenWizard] = useState(false);

  if (!shouldShow || dismissedThisSession) {
    // Mismo oculto, aún renderizamos o wizard caso esteja aberto.
    if (openWizard) {
      return (
        <GuidedOnboarding
          open={openWizard}
          onClose={() => setOpenWizard(false)}
          onComplete={async () => {
            await markCompleted();
            setOpenWizard(false);
          }}
          onSkipAll={() => {
            // No marca como pulado permanentemente — solo data o wizard.
            // A tarja continuará aparecendo até a conclusión definitiva.
            setOpenWizard(false);
          }}
        />
      );
    }
    return null;
  }

  return (
    <>
      <div className="sticky top-0 z-40 border-b border-yellow-300 bg-yellow-100 dark:bg-yellow-900/30 dark:border-yellow-700/50">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-400/30 text-yellow-700 dark:text-yellow-300">
            <Sparkles size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
              Completá la configuración inicial de tu cuenta
            </p>
            <p className="text-xs text-yellow-800/80 dark:text-yellow-200/80 hidden sm:block">
              Terminá el registro guiado para liberar todo el potencial de la plataforma.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setOpenWizard(true)}
            className="shrink-0 bg-yellow-500 hover:bg-yellow-600 text-yellow-950 gap-1.5"
          >
            Continuar
            <ArrowRight size={14} />
          </Button>
          <button
            onClick={() => setDismissedThisSession(true)}
            aria-label="Fechar"
            className="shrink-0 rounded p-1 text-yellow-800 hover:bg-yellow-200 dark:text-yellow-200 dark:hover:bg-yellow-800/40 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {openWizard && (
        <GuidedOnboarding
          open={openWizard}
          onClose={() => setOpenWizard(false)}
          onComplete={async () => {
            await markCompleted();
            setOpenWizard(false);
          }}
          onSkipAll={() => {
            // No marca como pulado permanentemente.
            setOpenWizard(false);
          }}
        />
      )}
    </>
  );
}
