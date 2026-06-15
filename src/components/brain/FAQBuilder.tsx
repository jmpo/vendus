import { useState } from 'react';
import { MessageSquare, Plus, Save, Trash2, Loader2, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { 
  useKnowledgeSourcesByType, 
  useCreateKnowledgeSource,
  useDeleteKnowledgeSource 
} from '@/hooks/useKnowledgeSources';
import { toast } from 'sonner';

interface FAQBuilderProps {
  productId: string;
}

export function FAQBuilder({ productId }: FAQBuilderProps) {
  const { fecha: faqs, isLoading } = useKnowledgeSourcesByType(productId, 'faq');
  const createFaq = useCreateKnowledgeSource();
  const deleteFaq = useDeleteKnowledgeSource();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const handleCreate = async () => {
    if (!question.trim() || !answer.trim()) {
      toast.error('Complete la pregunta y la respuesta');
      return;
    }

    try {
      await createFaq.mutateAsync({
        product_id: productId,
        source_type: 'faq',
        title: question.substring(0, 100),
        question,
        answer,
        extracted_content: `Pregunta: ${question}\nRespuesta: ${answer}`,
        processing_status: 'completed',
      });
      
      toast.success('FAQ creada con éxito');
      setQuestion('');
      setAnswer('');
      setIsDialogOpen(false);
    } catch (error) {
      toast.error('Error al crear FAQ');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFaq.mutateAsync({ id, productId });
      toast.success('FAQ eliminada');
    } catch (error) {
      toast.error('Error al eliminar FAQ');
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                FAQ - Preguntas Frecuentes
              </CardTitle>
              <CardDescription>
                Cree preguntas y respuestas estandarizadas para que la IA las use como referencia.
              </CardDescription>
            </div>
            
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Nueva FAQ
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Nueva Pregunta Frecuente</DialogTitle>
                  <DialogDescription>
                    Agregue una pregunta común y su respuesta ideal.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="question">Pregunta</Label>
                    <Input
                      id="question"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="Ej: ¿Cuál es el plazo de implementación?"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="answer">Respuesta</Label>
                    <Textarea
                      id="answer"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Escriba la respuesta ideal para esta pregunta..."
                      className="min-h-[150px]"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleCreate} disabled={createFaq.isPending}>
                    {createFaq.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Guardar FAQ
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : faqs && faqs.length > 0 ? (
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((faq) => (
                <AccordionItem key={faq.id} value={faq.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2 text-left">
                      <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="line-clamp-1">{faq.question}</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pl-6 space-y-3">
                      <p className="text-muted-foreground whitespace-pre-wrap">
                        {faq.answer}
                      </p>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(faq.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <div className="text-center py-8">
              <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                Aún no se ha creado ninguna FAQ. Haga clic en "Nueva FAQ" para comenzar.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <Card className="bg-gradient-to-r from-primary/5 to-transparent border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5" />
            <div>
              <h4 className="font-medium">Consejos para FAQ eficaces</h4>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                <li>• Usa preguntas que sus clientes realmente hacen</li>
                <li>• Incluya objeciones comunes y cómo superarlas</li>
                <li>• Agregue respuestas con datos y pruebas concretas</li>
                <li>• Mantenga las respuestas concisas pero completas</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
