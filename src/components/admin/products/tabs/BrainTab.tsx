import { useState } from 'react';
import { 
  Brain, 
  FileText, 
  Globe, 
  Youtube, 
  MessageSquare, 
  Database,
  Sparkles,
  ChevronRight,
  Loader2,
  Package
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useKnowledgeSources, useKnowledgeSourceStats } from '@/hooks/useKnowledgeSources';
import { FileUploader } from '@/components/brain/FileUploader';
import { FAQBuilder } from '@/components/brain/FAQBuilder';
import { AITrainingWidget } from '@/components/brain/AITrainingWidget';
import { KnowledgeSourceCard } from '@/components/brain/KnowledgeSourceCard';
import { BrainHealthScore } from '@/components/brain/BrainHealthScore';
import { WebsiteCrawler } from '@/components/brain/WebsiteCrawler';
import { YouTubeTranscriber } from '@/components/brain/YouTubeTranscriber';
import { CatalogManager } from './catalog/CatalogManager';
import { cn } from '@/lib/utils';

interface BrainTabProps {
  productId: string;
}

const SOURCE_TYPES = [
  { 
    id: 'file', 
    label: 'Archivos', 
    icon: FileText, 
    description: 'PDFs, DOCs, apresentações',
    color: 'text-blue-500'
  },
  { 
    id: 'website', 
    label: 'Websites', 
    icon: Globe, 
    description: 'URLs para crawling',
    color: 'text-green-500'
  },
  { 
    id: 'youtube', 
    label: 'Videos', 
    icon: Youtube, 
    description: 'Transcrição automática',
    color: 'text-red-500'
  },
  { 
    id: 'faq', 
    label: 'FAQ', 
    icon: MessageSquare, 
    description: 'Preguntas y respuestas',
    color: 'text-purple-500'
  },
  { 
    id: 'fecha', 
    label: 'Dados', 
    icon: Database, 
    description: 'Tablas y comparativos',
    color: 'text-orange-500'
  },
  { 
    id: 'training', 
    label: 'Entrenamiento', 
    icon: Sparkles, 
    description: 'Enseñe a la IA directamente',
    color: 'text-primary'
  },
  { 
    id: 'catalog', 
    label: 'Catálogo', 
    icon: Package, 
    description: 'Ítems que la IA puede buscar e enviar',
    color: 'text-pink-500'
  },
];

export function BrainTab({ productId }: BrainTabProps) {
  const { fecha: sources, isLoading: sourcesLoading } = useKnowledgeSources(productId);
  const { fecha: stats } = useKnowledgeSourceStats(productId);
  const [activeTab, setActiveTab] = useState('overview');
  const [activeSource, setActiveSource] = useState<string | null>(null);

  if (sourcesLoading) {
    return (
      <div className="flex ítems-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const healthScore = stats ? Math.round((stats.completed / Math.max(stats.total, 1)) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header with Health Score */}
      <div className="flex ítems-start justify-between">
        <div className="space-y-1">
          <div className="flex ítems-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex ítems-center justify-center">
              <Brain className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Cerebro del Producto</h2>
              <p className="text-sm text-muted-foreground">
                Alimente a la IA con conocimiento para respuestas más precisas
              </p>
            </div>
          </div>
        </div>
        <BrainHealthScore score={healthScore} stats={stats} />
      </div>

      {/* Description Card */}
      <Card className="bg-gradient-to-r from-primary/5 to-transparent border-primary/20">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            Adicione conhecimento através de diferentes fontes. Quanto mais dados, mais inteligente 
            a IA ficará para ajudar com objeções, cadencias e respuestas contextualizadas.
          </p>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="overview">Vista General</TabsTrigger>
          <TabsTrigger value="files">Archivos</TabsTrigger>
          <TabsTrigger value="websites">Websites</TabsTrigger>
          <TabsTrigger value="youtube">YouTube</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="training">Entrenamiento IA</TabsTrigger>
          <TabsTrigger value="catalog">Catálogo</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Source Type Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {SOURCE_TYPES.map((type) => {
              const Icon = type.icon;
              const count = stats?.[type.id as keyof typeof stats] || 0;
              
              return (
                <Card 
                  key={type.id}
                  className={cn(
                    'cursor-pointer transition-all hover:border-primary/50 hover:shadow-md',
                    activeSource === type.id && 'border-primary ring-1 ring-primary/20'
                  )}
                  onClick={() => {
                    if (type.id === 'file') setActiveTab('files');
                    else if (type.id === 'website') setActiveTab('websites');
                    else if (type.id === 'youtube') setActiveTab('youtube');
                    else if (type.id === 'faq') setActiveTab('faq');
                    else if (type.id === 'training') setActiveTab('training');
                    else if (type.id === 'catalog') setActiveTab('catalog');
                    else setActiveSource(type.id);
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex ítems-start justify-between">
                      <div className={cn('p-2 rounded-lg bg-muted', type.color)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {count} {count === 1 ? 'ítem' : 'ítems'}
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <h3 className="font-medium">{type.label}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{type.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground mt-3" />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Recent Sources */}
          {sources && sources.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Fuentes Recientes</h3>
              <div className="space-y-3">
                {sources.slice(0, 5).map((source) => (
                  <KnowledgeSourceCard key={source.id} source={source} />
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {(!sources || sources.length === 0) && (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center">
                <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-semibold mb-2">Comience a entrenar el cerebro</h3>
                <p className="text-muted-foreground mb-4">
                  Añada archivos, FAQs o entrene a la IA directamente para mejorar las respuestas.
                </p>
                <div className="flex justify-center gap-3">
                  <Button onClick={() => setActiveTab('files')}>
                    <FileText className="h-4 w-4 mr-2" />
                    Añadir Archivo
                  </Button>
                  <Button variant="outline" onClick={() => setActiveTab('faq')}>
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Crear FAQ
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="files" className="mt-6">
          <FileUploader productId={productId} />
        </TabsContent>

        <TabsContent value="websites" className="mt-6">
          <WebsiteCrawler productId={productId} />
        </TabsContent>

        <TabsContent value="youtube" className="mt-6">
          <YouTubeTranscriber productId={productId} />
        </TabsContent>

        <TabsContent value="faq" className="mt-6">
          <FAQBuilder productId={productId} />
        </TabsContent>

        <TabsContent value="training" className="mt-6">
          <AITrainingWidget productId={productId} />
        </TabsContent>

        <TabsContent value="catalog" className="mt-6">
          <CatalogManager productId={productId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
