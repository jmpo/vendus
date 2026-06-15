/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const TestEmail = () => (
  <Html lang="es-PY" dir="ltr">
    <Head />
    <Preview>Prueba de envío - Vendus</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>✅ Prueba de envío</Heading>
        <Text style={text}>
          Este es un email de prueba enviado por la plataforma Vendus.
          Si lo recibiste, la infraestructura de email está funcionando correctamente.
        </Text>
        <Text style={footer}>Vendus — {new Date().getFullYear()}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TestEmail,
  subject: 'Prueba de envío - Vendus',
  displayName: 'Email de prueba',
  previewData: {},
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: 'hsl(222, 47%, 11%)', margin: '0 0 20px' }
const text = { fontSize: '14px', color: 'hsl(220, 8%, 46%)', lineHeight: '1.6', margin: '0 0 24px' }
const footer = { fontSize: '12px', color: '#999999', margin: '32px 0 0' }
