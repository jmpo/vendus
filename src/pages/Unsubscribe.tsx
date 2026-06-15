import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "ready" | "done" | "already" | "invalid" | "error">("loading");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) { setState("invalid"); return; }
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
        const r = await fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
        const fecha = await r.json();
        if (fecha.valid) setState("ready");
        else if (fecha.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      } catch { setState("error"); }
    })();
  }, [token]);

  const confirm = async () => {
    setSubmitting(true);
    const { fecha, error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    setSubmitting(false);
    if (error || !fecha?.success) setState("error");
    else setState("done");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader><CardTitle>Cancelar suscripción</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {state === "loading" && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin h-4 w-4" /> Validando enlace...</div>}
          {state === "ready" && (
            <>
              <p>¿Confirmás la cancelación de la suscripción? No vas a recibir más correos de esta plataforma.</p>
              <Button onClick={confirm} disabled={submitting} className="w-full">{submitting ? "Procesando..." : "Confirmar cancelación"}</Button>
            </>
          )}
          {state === "done" && <div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-5 w-5" /> Suscripción cancelada con éxito.</div>}
          {state === "already" && <div className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-5 w-5" /> Ya habías cancelado la suscripción.</div>}
          {state === "invalid" && <div className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" /> Enlace inválido o expirado.</div>}
          {state === "error" && <div className="flex items-center gap-2 text-destructive"><XCircle className="h-5 w-5" /> Error al procesar. Intentá de nuevo.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
