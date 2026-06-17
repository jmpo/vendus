import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Braces } from 'lucide-react';

export type VariableGroup = {
  label: string;
  vars: Array<{ key: string; description: string }>;
};

export const POST_SALE_VARIABLE_GROUPS: VariableGroup[] = [
  {
    label: 'Lead',
    vars: [
      { key: 'lead_name', description: 'Nombre del lead' },
      { key: 'lead_email', description: 'E-mail del lead' },
      { key: 'lead_phone', description: 'Teléfono del lead' },
    ],
  },
  {
    label: 'Producto / Oferta',
    vars: [
      { key: 'product_name', description: 'Nombre do producto' },
      { key: 'offer_name', description: 'Nombre da oferta' },
    ],
  },
  {
    label: 'Pedido',
    vars: [
      { key: 'amount', description: 'Valor (número)' },
      { key: 'amount_formatted', description: 'Valor formatado (ex.: 197,00)' },
      { key: 'currency', description: 'Moeda' },
      { key: 'transaction_id', description: 'ID da transação' },
      { key: 'order_id', description: 'ID/código do pedido' },
      { key: 'payment_method', description: 'Forma de pago' },
      { key: 'installments', description: 'Parcelas' },
    ],
  },
  {
    label: 'Links',
    vars: [
      { key: 'payment_link', description: 'Link de pago' },
      { key: 'checkout_url', description: 'URL do checkout' },
      { key: 'receipt_url', description: 'Link do recibo' },
      { key: 'invoice_url', description: 'Link da fatura' },
    ],
  },
  {
    label: 'PIX',
    vars: [
      { key: 'pix_code', description: 'Código copia-e-cola do PIX' },
      { key: 'pix_qrcode_url', description: 'Imagen do QR Code' },
      { key: 'pix_expires_at', description: 'Validade do PIX' },
    ],
  },
  {
    label: 'Boleto',
    vars: [
      { key: 'boleto_url', description: 'URL do boleto (PDF)' },
      { key: 'boleto_barcode', description: 'Línea digitável' },
      { key: 'boleto_expires_at', description: 'Vencimento do boleto' },
    ],
  },
  {
    label: 'Comprador',
    vars: [
      { key: 'customer_name', description: 'Nombre do comprador' },
      { key: 'customer_email', description: 'E-mail do comprador' },
      { key: 'customer_phone', description: 'Teléfono do comprador' },
      { key: 'customer_document', description: 'CPF/CNPJ' },
    ],
  },
];

interface Props {
  /** ref para o textarea/input — usada para inserir na posición do cursor */
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>;
  value: string;
  onChange: (next: string) => void;
}

export function PostSaleVariablePicker({ targetRef, value, onChange }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const el = targetRef.current;
    if (!el) {
      onChange(`${value}${token}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      try { el.setSelectionRange(pos, pos); } catch { /* input number etc. */ }
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button ref={buttonRef} type="button" variant="outline" size="sm" className="h-8 gap-1.5">
          <Braces className="h-3.5 w-3.5" />
          Variables
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Inserir variable</p>
          <p className="text-xs text-muted-foreground">
            Hacé clic para inserir na posición do cursor.
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto p-2 space-y-3">
          {POST_SALE_VARIABLE_GROUPS.map((g) => (
            <div key={g.label}>
              <p className="px-1 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {g.label}
              </p>
              <div className="space-y-0.5">
                {g.vars.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insert(v.key)}
                    className="w-full text-left rounded px-2 py-1.5 hover:bg-accent transition-colors"
                  >
                    <code className="text-xs font-mono text-primary">{`{{${v.key}}}`}</code>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{v.description}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
