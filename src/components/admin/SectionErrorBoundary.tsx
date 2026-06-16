import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  sectionName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Captura errores de carga de chunks lazy (común tras deploy cuando el
 * navegador tiene hash antiguo en caché) y muestra botón para recargar la página.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('[SectionErrorBoundary]', this.props.sectionName, error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const isChunkError = /chunk|loading.*module|dynamically imported/i.test(
        this.state.error?.message || ''
      );
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold mb-2">
            No se pudo cargar esta sección
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-4">
            {isChunkError
              ? 'La versión de la aplicación fue actualizada. Recargá la página para continuar.'
              : 'Ocurrió un error al abrir esta sección. Intentá recargar.'}
          </p>
          <Button onClick={this.handleReload}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Recargar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
