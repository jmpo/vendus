/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  fullName?: string | null
  planName?: string | null
  recoveryLink?: string | null
  email?: string | null
}

const WelcomeAdminAccessEmail = ({
  fullName,
  planName,
  recoveryLink,
  email,
}: Props) => (
  <Html lang="es-PY" dir="ltr">
    <Head />
    <Preview>Tu acceso de administrador está listo</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>¡Bienvenido(a){fullName ? `, ${fullName}` : ''}!</Heading>
        <Text style={text}>
          Recibimos la confirmación de tu compra
          {planName ? ` del plan ${planName}` : ''} y tu acceso de
          administrador ya está activo.
        </Text>
        <Text style={text}>
          Para definir tu contraseña e ingresar por primera vez, hacé clic en el botón de abajo:
        </Text>
        {recoveryLink ? (
          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button href={recoveryLink} style={button}>
              Definir mi contraseña
            </Button>
          </Section>
        ) : (
          <Text style={text}>
            Usá la opción "Olvidé mi contraseña" en la pantala de login con el e-mail
            <strong> {email}</strong> para crear tu contraseña de acceso.
          </Text>
        )}
        <Hr style={hr} />
        <Text style={muted}>
          Si no reconocés esta compra, simplemente ignorá este e-mail.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomeAdminAccessEmail,
  subject: (data: Record<string, any>) =>
    data.planName
      ? `Tu acceso al plan ${data.planName} está listo`
      : 'Tu acceso de administrador está listo',
  displayName: 'Bienvenida — acceso admin (Cakto)',
  previewData: {
    fullName: 'María',
    planName: 'Pro',
    email: 'maria@ejemplo.com',
    recoveryLink: 'https://app.ejemplo.com/reset?token=abc',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'Inter, Arial, sans-serif',
  margin: 0,
  padding: 0,
}
const container = { padding: '32px 28px', maxWidth: '600px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 700, color: '#111827', margin: '0 0 16px' }
const text = { fontSize: '15px', lineHeight: '24px', color: '#374151', margin: '0 0 12px' }
const muted = { fontSize: '13px', color: '#6b7280', margin: '12px 0 0' }
const hr = { borderColor: '#e5e7eb', margin: '28px 0' }
const button = {
  backgroundColor: '#111827',
  color: '#ffffff',
  padding: '12px 22px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
}
