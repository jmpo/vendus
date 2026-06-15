import { useParams, useNavigate, Link } from 'react-router-dom';
import { useHelpArticle } from '@/hooks/useHelp';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, ThumbsUp, ThumbsDown, Share2, Sparkles, BookOpen, Calendar } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function HelpArticle() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: article, isLoading } = useHelpArticle(slug);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Cargando artículo...</div>;
  }
  if (!article) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Artículo no encontrado.</p>
        <Link to="/ayuda"><Button variant="outline">Volver al Centro de Ayuda</Button></Link>
      </div>
    );
  }

  const handleFeedback = async (helpful: boolean) => {
    if (!user) return;
    setFeedback(helpful ? 'up' : 'down');
    const { error } = await supabase.from('help_article_feedback').upsert({
      article_id: article.id, user_id: user.id, is_helpful: helpful,
    }, { onConflict: 'article_id,user_id' });
    if (error) { toast.error('Error al enviar el feedback'); return; }
    toast.success('¡Gracias por tu feedback!');
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: article.title, url });
      else { await navigator.clipboard.writeText(url); toast.success('Enlace copiado'); }
    } catch {}
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/ayuda')}><ArrowLeft className="h-4 w-4" /></Button>
          <Link to="/ayuda" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <BookOpen className="h-4 w-4" /> Centro de Ayuda
          </Link>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={share} className="gap-2"><Share2 className="h-4 w-4" /> Compartir</Button>
          </div>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="space-y-3">
          {article.help_categories && (
            <Badge variant="secondary">{article.help_categories.name}</Badge>
          )}
          <h1 className="text-3xl font-bold">{article.title}</h1>
          {article.summary && <p className="text-lg text-muted-foreground">{article.summary}</p>}
          {article.published_at && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              Publicado el {format(new Date(article.published_at), "d 'de' MMMM 'de' yyyy", { locale: es })}
            </div>
          )}
        </div>

        {article.cover_image_url && (
          <img src={article.cover_image_url} alt="" className="w-full rounded-lg border" />
        )}

        {article.related_release_id && (
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4 flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-primary" />
              <div className="flex-1 text-sm">Este artículo describe una novedad de la plataforma.</div>
              <Link to="/novedades"><Button size="sm" variant="outline">Ver actualizaciones</Button></Link>
            </CardContent>
          </Card>
        )}

        <div
          className="prose prose-sm sm:prose dark:prose-invert max-w-none prose-img:rounded-lg prose-a:text-primary"
          dangerouslySetInnerHTML={{ __html: article.content_html || '<p><em>Contenido próximamente.</em></p>' }}
        />

        <div className="border-t pt-6 space-y-3">
          <p className="text-sm font-medium">¿Te resultó útil este artículo?</p>
          <div className="flex gap-2">
            <Button variant={feedback === 'up' ? 'default' : 'outline'} size="sm" onClick={() => handleFeedback(true)} className="gap-2">
              <ThumbsUp className="h-4 w-4" /> Sí
            </Button>
            <Button variant={feedback === 'down' ? 'default' : 'outline'} size="sm" onClick={() => handleFeedback(false)} className="gap-2">
              <ThumbsDown className="h-4 w-4" /> No
            </Button>
          </div>
        </div>
      </article>
    </div>
  );
}
