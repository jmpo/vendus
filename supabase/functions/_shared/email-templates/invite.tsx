/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="es-PY" dir="ltr">
    <Head />
    <Preview>Fuiste invitado a {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>¡Fuiste invitado!</Heading>
        <Text style={text}>
          Recibiste una invitación para participar de{' '}
          <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>.
          Hacé clic en el botón de abajo para aceptar y crear tu cuenta.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Aceptar invitación
        </Button>
        <Text style={footer}>
          Si no esperabas esta invitación, podés ignorar este e-mail sin problema.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: 'hsl(222, 47%, 11%)', margin: '0 0 20px' }
const text = { fontSize: '14px', color: 'hsl(220, 8%, 46%)', lineHeight: '1.6', margin: '0 0 24px' }
const link = { color: 'hsl(83, 81%, 38%)', textDecoration: 'underline' }
const button = {
  backgroundColor: 'hsl(83, 81%, 44%)',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  borderRadius: '12px',
  padding: '12px 22px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '32px 0 0' }
