import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Loader2, Sparkles, PenLine } from 'lucide-react';
import { useSaveSingleObjection, useHandleObjection } from '@/hooks/useObjectionAI';
import { toast } from 'sonner';

interface ManualObjectionFormProps {
  productId: string;
  productName?: string;
  onSuccess?: () => void;
}

const categories = [
  { value: 'price', label: 'Precio' },
  { value: 'timing', label: 'Timing' },
  { value: 'trust', label: 'Confianza' },
  { value: 'thinking', label: 'Lo voy a pensar' },
  { value: 'partner', label: 'Socio/Director' },
  { value: 'competitor', label: 'Competencia' },
];

export function ManualObjectionForm({ productId, productName, onSuccess }: ManualObjectionFormProps) {
  const [category, setCategory] = useState<string>('thinking');
  const [whatTheySay, setWhatTheySay] = useState('');
  const [whatTheyMean, setWhatTheyMean] = useState('');
  const [suggestedResponse, setSuggestedResponse] = useState('');
  const [followUpQuestion, setFollowUpQuestion] = useState('');
  const [refiningField, setRefiningField] = useState<string | null>(null);

  const saveObjection = useSaveSingleObjection();
  const { handleObjection, isLoading: isRefining } = useHandleObjection();

  const handleRefineWithAI = async (field: 'whatTheyMean' | 'suggestedResponse' | 'followUpQuestion') => {
    if (!whatTheySay.trim()) {
      toast.error('Ingrese primero la objeción del cliente');
      return;
    }

    setRefiningField(field);

    try {
      const response = await handleObjection(whatTheySay, productId);
      
      if (response) {
        // Parse the AI response
        const whatTheyMeanMatch = response.match(/\*\*LO QUE QUIERE DECIR:\*\*\s*([\s\S]*?)(?=\*\*RESPUESTA SUGERIDA:\*\*|$)/i);
        const responseMatch = response.match(/\*\*RESPUESTA SUGERIDA:\*\*\s*([\s\S]*?)(?=\*\*PREGUNTA DE RETORNO:\*\*|$)/i);
        const questionMatch = response.match(/\*\*PREGUNTA DE RETORNO:\*\*\s*([\s\S]*?)$/i);

        if (field === 'whatTheyMean' && whatTheyMeanMatch?.[1]) {
          setWhatTheyMean(whatTheyMeanMatch[1].trim());
        } else if (field === 'suggestedResponse' && responseMatch?.[1]) {
          setSuggestedResponse(responseMatch[1].trim());
        } else if (field === 'followUpQuestion' && questionMatch?.[1]) {
          setFollowUpQuestion(questionMatch[1].trim());
        }
        
        toast.success('¡Campo refinado con IA!');
      }
    } catch (error) {
      toast.error('Error al refinar con IA');
    } finally {
      setRefiningField(null);
    }
  };

  const handleRefineAll = async () => {
    if (!whatTheySay.trim()) {
      toast.error('Ingrese primero la objeción del cliente');
      return;
    }

    setRefiningField('all');

    try {
      const response = await handleObjection(whatTheySay, productId);
      
      if (response) {
        const whatTheyMeanMatch = response.match(/\*\*LO QUE QUIERE DECIR:\*\*\s*([\s\S]*?)(?=\*\*RESPUESTA SUGERIDA:\*\*|$)/i);
        const responseMatch = response.match(/\*\*RESPUESTA SUGERIDA:\*\*\s*([\s\S]*?)(?=\*\*PREGUNTA DE RETORNO:\*\*|$)/i);
        const questionMatch = response.match(/\*\*PREGUNTA DE RETORNO:\*\*\s*([\s\S]*?)$/i);

        if (whatTheyMeanMatch?.[1]) setWhatTheyMean(whatTheyMeanMatch[1].trim());
        if (responseMatch?.[1]) setSuggestedResponse(responseMatch[1].trim());
        if (questionMatch?.[1]) setFollowUpQuestion(questionMatch[1].trim());
        
        toast.success('¡Todos los campos generados con IA!');
      }
    } catch (error) {
      toast.error('Error al generar con IA');
    } finally {
      setRefiningField(null);
    }
  };

  const handleSave = async () => {
    if (!whatTheySay.trim()) {
      toast.error('Ingrese la objeción del cliente');
      return;
    }
    if (!suggestedResponse.trim()) {
      toast.error('Ingrese la respuesta sugerida');
      return;
    }

    try {
      await saveObjection.mutateAsync({
        productId,
        objection: {
          category,
          what_they_say: whatTheySay.trim(),
          what_they_mean: whatTheyMean.trim(),
          suggested_response: suggestedResponse.trim(),
          follow_up_question: followUpQuestion.trim(),
        },
      });
      
      toast.success('¡Objeción guardada con éxito!');
      
      // Reset form
      setWhatTheySay('');
      setWhatTheyMean('');
      setSuggestedResponse('');
      setFollowUpQuestion('');
      setCategory('thinking');
      
      onSuccess?.();
    } catch (error) {
      toast.error('Error al guardar la objeción');
    }
  };

  const isFormValid = whatTheySay.trim() && suggestedResponse.trim();

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center">
              <PenLine className="h-4 w-4 text-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">Agregar Objeción Manual</CardTitle>
              {productName && (
                <p className="text-xs text-muted-foreground">
                  Producto: {productName}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Category Selection */}
        <div className="space-y-2">
          <Label>Categoría</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccione la categoría" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* What They Say */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Lo que dice el cliente *</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefineAll}
              disabled={!whatTheySay.trim() || refiningField !== null}
              className="gap-1 text-xs h-7"
            >
              {refiningField === 'all' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Generar todo con IA
            </Button>
          </div>
          <Textarea
            placeholder='Ex: "Es muy caro para mi presupuesto"'
            value={whatTheySay}
            onChange={(e) => setWhatTheySay(e.target.value)}
            className="min-h-[60px] resize-none"
          />
        </div>

        {/* What They Mean */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Lo que quiere decir</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRefineWithAI('whatTheyMean')}
              disabled={!whatTheySay.trim() || refiningField !== null}
              className="gap-1 text-xs h-7"
            >
              {refiningField === 'whatTheyMean' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Refinar con IA
            </Button>
          </div>
          <Textarea
            placeholder="El miedo o duda real detrás de la objeción"
            value={whatTheyMean}
            onChange={(e) => setWhatTheyMean(e.target.value)}
            className="min-h-[60px] resize-none"
          />
        </div>

        {/* Suggested Response */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Respuesta sugerida *</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRefineWithAI('suggestedResponse')}
              disabled={!whatTheySay.trim() || refiningField !== null}
              className="gap-1 text-xs h-7"
            >
              {refiningField === 'suggestedResponse' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Refinar con IA
            </Button>
          </div>
          <Textarea
            placeholder="La respuesta estratégica para superar esta objeción"
            value={suggestedResponse}
            onChange={(e) => setSuggestedResponse(e.target.value)}
            className="min-h-[80px] resize-none"
          />
        </div>

        {/* Follow-up Question */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Pregunta de retorno</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRefineWithAI('followUpQuestion')}
              disabled={!whatTheySay.trim() || refiningField !== null}
              className="gap-1 text-xs h-7"
            >
              {refiningField === 'followUpQuestion' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Refinar con IA
            </Button>
          </div>
          <Textarea
            placeholder="Pregunta para involucrar y avanzar en la conversación"
            value={followUpQuestion}
            onChange={(e) => setFollowUpQuestion(e.target.value)}
            className="min-h-[60px] resize-none"
          />
        </div>

        {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={!isFormValid || saveObjection.isPending}
          className="w-full"
        >
          {saveObjection.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Guardar Objeción
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
