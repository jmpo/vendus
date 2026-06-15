import { useState } from 'react';
import { Sparkles, Send, Loader2, Bot, User, Save, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  useKnowledgeSourcesByType, 
  useCreateKnowledgeSource,
  useDeleteKnowledgeSource 
} from '@/hooks/useKnowledgeSources';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AITrainingWidgetProps {
  productId: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function AITrainingWidget({ productId }: AITrainingWidgetProps) {
  const { fecha: trainings, isLoading } = useKnowledgeSourcesByType(productId, 'training');
  const createTraining = useCreateKnowledgeSource();
  const deleteTraining = useDeleteKnowledgeSource();
  
  const [activeTab, setActiveTab] = useState('teach');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);

  const handleSaveTraining = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error('Complete el título y el contenido');
      return;
    }

    try {
      await createTraining.mutateAsync({
        product_id: productId,
        source_type: 'training',
        title,
        description: 'Entrenamiento manual',
        extracted_content: content,
        raw_content: content,
        processing_status: 'completed',
      });
      
      toast.success('Entrenamiento guardado con éxito');
      setTitle('');
      setContent('');
    } catch (error) {
      toast.error('Error al guardar el entrenamiento');
    }
  };

  const handleDeleteTraining = async (id: string) => {
    try {
      await deleteTraining.mutateAsync({ id, productId });
      toast.success('Entrenamiento eliminado');
    } catch (error) {
      toast.error('Error al eliminar el entrenamiento');
    }
  };

  const handleSimulateChat = async () => {
    if (!userInput.trim()) return;

    const userMessage: Message = { role: 'user', content: userInput };
    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setIsSimulating(true);

    // Simulate AI response (in production, this would call the sales-copilot function)
    setTimeout(() => {
      const aiResponse: Message = {
        role: 'assistant',
        content: 'Esta es una simulación. En producción, la respuesta se basaría en todo el conocimiento entrenado para este producto, incluyendo documentos, FAQ y entrenamientos manuales.',
      };
      setMessages(prev => [...prev, aiResponse]);
      setIsSimulating(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="teach">Enseñar a la IA</TabsTrigger>
          <TabsTrigger value="simulate">Simular Conversación</TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="teach" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Enseñe a la IA
              </CardTitle>
              <CardDescription>
                Agregue información específica que desee que la IA sepa sobre el producto.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="training-title">Título del Entrenamiento</Label>
                <Input
                  id="training-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Proceso de onboarding, Casos de éxito..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="training-content">Contenido</Label>
                <Textarea
                  id="training-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Escriba todo lo que desee que la IA sepa sobre este tema. Puede incluir ejemplos, guiones, casos de uso, etc..."
                  className="min-h-[200px]"
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveTraining} disabled={createTraining.isPending}>
                  {createTraining.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Guardar Entrenamiento
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="bg-gradient-to-r from-primary/5 to-transparent border-primary/20 mt-4">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h4 className="font-medium">¿Qué enseñarle a la IA?</h4>
                  <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                    <li>• Guiones de ventas que funcionan bien</li>
                    <li>• Cómo manejar objeciones específicas</li>
                    <li>• Casos de éxito detallados con números</li>
                    <li>• Diferenciales competitivos profundos</li>
                    <li>• Proceso de implementación paso a paso</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="simulate" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Simulador de Conversación
              </CardTitle>
              <CardDescription>
                Pruebe cómo responde la IA basándose en el conocimiento actual del producto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] border rounded-lg p-4 mb-4">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <p>Haga una pregunta para iniciar la simulación</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message, index) => (
                      <div
                        key={index}
                        className={cn(
                          'flex gap-3',
                          message.role === 'user' ? 'justify-end' : 'justify-start'
                        )}
                      >
                        {message.role === 'assistant' && (
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary text-primary-foreground">
                              <Bot className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div
                          className={cn(
                            'max-w-[80%] rounded-lg px-4 py-2',
                            message.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          )}
                        >
                          <p className="text-sm">{message.content}</p>
                        </div>
                        {message.role === 'user' && (
                          <Avatar className="h-8 w-8">
                            <AvatarFallback>
                              <User className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                    ))}
                    {isSimulating && (
                      <div className="flex gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary text-primary-foreground">
                            <Bot className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="bg-muted rounded-lg px-4 py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              <div className="flex gap-2">
                <Input
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="Haga una pregunta sobre el producto..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSimulateChat();
                    }
                  }}
                />
                <Button onClick={handleSimulateChat} disabled={isSimulating}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Treinamentos</CardTitle>
              <CardDescription>
                Todos los entrenamientos manuales agregados para este producto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : trainings && trainings.length > 0 ? (
                <div className="space-y-4">
                  {trainings.map((training) => (
                    <Card key={training.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <h4 className="font-medium">{training.title}</h4>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {training.extracted_content}
                            </p>
                            <Badge variant="secondary" className="text-xs mt-2">
                              {new Date(training.created_at).toLocaleDateString('es-PY')}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDeleteTraining(training.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Sparkles className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    Aún no hay entrenamientos manuales. Vaya a "Enseñar a la IA" para comenzar.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
