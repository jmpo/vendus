import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Copy, Download, Share2, Check, Link2, QrCode, MessageCircle, Mail, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { usePublicAppUrl } from '@/lib/publicUrl';

interface BookingLinkShareProps {
  userId: string;
}

const generateBookingSlug = (fullName: string): string => {
  return fullName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
};

export function BookingLinkShare({ userId }: BookingLinkShareProps) {
  const { profile } = useAuth();
  const [bookingSlug, setBookingSlug] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  const { data: baseUrl } = usePublicAppUrl();
  const bookingUrl = `${baseUrl}/agendar/${bookingSlug}`;

  useEffect(() => {
    const initSlug = async () => {
      if (profile?.booking_slug) {
        setBookingSlug(profile.booking_slug);
        setNewSlug(profile.booking_slug);
      } else if (profile?.full_name) {
        // Auto-generate slug from name
        const generatedSlug = generateBookingSlug(profile.full_name);
        
        // Check uniqueness and save
        const { data: existing } = await supabase
          .from('profiles')
          .select('id')
          .eq('booking_slug', generatedSlug)
          .neq('id', userId)
          .single();

        const finalSlug = existing ? `${generatedSlug}-${Date.now().toString(36)}` : generatedSlug;

        const { error } = await supabase
          .from('profiles')
          .update({ booking_slug: finalSlug })
          .eq('id', userId);

        if (!error) {
          setBookingSlug(finalSlug);
          setNewSlug(finalSlug);
        }
      }
    };

    initSlug();
  }, [profile, userId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      toast.success('¡Enlace copiado!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Error al copiar');
    }
  };

  const handleSaveSlug = async () => {
    if (!newSlug.trim()) {
      toast.error('El slug no puede estar vacío');
      return;
    }

    const sanitizedSlug = newSlug
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');

    if (sanitizedSlug !== newSlug) {
      setNewSlug(sanitizedSlug);
    }

    setIsSaving(true);

    // Check uniqueness
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('booking_slug', sanitizedSlug)
      .neq('id', userId)
      .single();

    if (existing) {
      toast.error('Este enlace ya está en uso');
      setIsSaving(false);
      return;
    }

    const { error } = await supabase
      .from('profiles')
      .update({ booking_slug: sanitizedSlug })
      .eq('id', userId);

    if (error) {
      toast.error('Error al guardar');
    } else {
      setBookingSlug(sanitizedSlug);
      setIsEditing(false);
      toast.success('¡Enlace actualizado!');
    }
    
    setIsSaving(false);
  };

  const handleDownloadQR = () => {
    if (!qrRef.current) return;

    const svg = qrRef.current.querySelector('svg');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const link = document.createElement('a');
      link.download = `qrcode-agendamento-${bookingSlug}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const handleShareWhatsApp = () => {
    const text = `Agenda una reunión conmigo: ${bookingUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleShareEmail = () => {
    const subject = 'Agenda una reunión conmigo';
    const body = `¡Hola!\n\nPuedes agendar una reunión conmigo a través de este enlace:\n${bookingUrl}\n\n¡Te espero!`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Agenda una reunión',
          text: 'Agenda una reunión conmigo',
          url: bookingUrl,
        });
      } catch {
        // User cancelled
      }
    }
  };

  if (!bookingSlug) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Link Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Tu Enlace de Agendamiento
          </CardTitle>
          <CardDescription>
            Comparte este enlace para que los clientes agenden reuniones directamente contigo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isEditing ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Personaliza tu enlace</Label>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-0 rounded-md border bg-muted/50">
                    <span className="px-3 text-sm text-muted-foreground whitespace-nowrap">
                      {baseUrl}/agendar/
                    </span>
                    <Input
                      value={newSlug}
                      onChange={(e) => setNewSlug(e.target.value)}
                      className="border-0 bg-transparent focus-visible:ring-0 px-0"
                      placeholder="seu-nome"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveSlug} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Salvar
                </Button>
                <Button variant="outline" onClick={() => { setIsEditing(false); setNewSlug(bookingSlug); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
                <span className="flex-1 text-sm font-medium truncate">{bookingUrl}</span>
                <Button size="sm" variant="ghost" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                Personalizar Enlace
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR Code Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            QR Code
          </CardTitle>
          <CardDescription>
            Escanea o descarga el código QR para compartir
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div 
              ref={qrRef} 
              className="p-4 bg-white rounded-xl shadow-sm border"
            >
              <QRCodeSVG
                value={bookingUrl}
                size={160}
                level="H"
                includeMargin={false}
              />
            </div>
            <div className="flex-1 space-y-3 text-center sm:text-left">
              <p className="text-sm text-muted-foreground">
                Imprímelo en tarjetas de presentación, materiales o muéstralo en presentaciones para facilitar el agendamiento.
              </p>
              <Button onClick={handleDownloadQR} variant="outline" className="w-full sm:w-auto">
                <Download className="h-4 w-4 mr-2" />
                Descargar código QR
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Share Options Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Compartilhar
          </CardTitle>
          <CardDescription>
            Envía tu enlace de agendamiento por diferentes canales
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Button 
              variant="outline" 
              className="flex flex-col items-center gap-2 h-auto py-4"
              onClick={handleCopy}
            >
              <Copy className="h-5 w-5" />
              <span className="text-xs">Copiar</span>
            </Button>
            
            <Button 
              variant="outline" 
              className="flex flex-col items-center gap-2 h-auto py-4 text-green-600 hover:text-green-700 hover:bg-green-50"
              onClick={handleShareWhatsApp}
            >
              <MessageCircle className="h-5 w-5" />
              <span className="text-xs">WhatsApp</span>
            </Button>
            
            <Button 
              variant="outline" 
              className="flex flex-col items-center gap-2 h-auto py-4"
              onClick={handleShareEmail}
            >
              <Mail className="h-5 w-5" />
              <span className="text-xs">Email</span>
            </Button>
            
            {typeof navigator.share === 'function' && (
              <Button 
                variant="outline" 
                className="flex flex-col items-center gap-2 h-auto py-4"
                onClick={handleNativeShare}
              >
                <Share2 className="h-5 w-5" />
                <span className="text-xs">Más</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
