import os
import re

replacements = {
    "src/components/ai/AIChat.tsx": [
        ("O lead disse que está caro. Me dá 3 respostas", "El lead dijo que es caro. Dame 3 respuestas"),
        ("Qual a melhor pergunta pra qualificar agora?", "¿Cuál es a mejor pregunta para cualificar ahora?"),
        ("Ele pediu preço cedo, como voltar pro valor?", "Pidió el precio pronto, ¿cómo volver al valor?"),
        ("Gera um script de follow-up", "Genera un script de seguimiento"),
        ("Simula uma negociação comigo", "Simula una negociación conmigo"),
        ("Olá! 👋 Sou o assistente de vendas do", "¡Hola! 👋 Soy el asistente de vendas del"),
        ("Estou aqui para te ajudar com:", "Estoy aquí para ayudarte con:"),
        ("- Respostas para objeções", "- Respuestas a objeciones"),
        ("- Sugestões de próxima ação", "- Sugerencias para la próxima acción"),
        ("- Geração de mensagens e scripts", "- Generación de mensajes y scripts"),
        ("- Roleplay e simulações", "- Roleplay y simulaciones"),
        ("Como posso te ajudar agora?", "¿Cómo puedo ayudarte ahora?"),
        ("Por favor, selecione uma imagem", "Por favor, selecciona una imagen"),
        ("Imagem muito grande. Máximo 5MB", "Imagen muy grande. Máximo 5MB"),
        ("Limite de requisições excedido. Aguarde um momento.", "Límite de solicitudes excedido. Espera un momento."),
        ("Créditos de IA esgotados.", "Créditos de IA agotados."),
        ("Erro ao processar requisição", "Error al procesar la solicitud"),
        ("Sem resposta do servidor", "Sin respuesta del servidor"),
        ("Me dá mais opções", "Dame más opciones"),
        ("Adapta pra WhatsApp", "Adapta para WhatsApp"),
        ("Qual material devo enviar?", "¿Qué material debo enviar?"),
        ("E se ele disser que vai pensar?", "¿Y si dice que lo va a pensar?"),
        ("Analise esta imagem e me dê um feedback estratégico para a venda.", "Analiza esta imagen y dame un feedback estratégico para la venda."),
        ("Erro ao processar mensagem", "Error al procesar el mensaje"),
        ("Tente novamente ou reformule sua pergunta.", "Intenta de nuevo o reformula tu pregunta."),
        ("Resposta copiada!", "¡Respuesta copiada!"),
        ("IA do", "IA de"),
        ("Seu copiloto de vendas", "Tu copiloto de ventas"),
        ("Imagem anexada", "Imagen adjunta"),
        ("Copiar", "Copiar"),
        ("Transcrevendo áudio...", "Transcribiendo audio..."),
        ("Cancelar gravação", "Cancelar grabación"),
        ("Confirmar gravação", "Confirmar grabación"),
        ("Digite uma mensagem ou envie um áudio...", "Escribe un mensaje o envía un audio..."),
        ("Anexar imagem", "Adjuntar imagen")
    ]
}

for file_path, pairs in replacements.items():
    if not os.path.exists(file_path): continue
    with open(file_path, 'r') as f:
        content = f.read()
    for old, new in pairs:
        content = content.replace(old, new)
    with open(file_path, 'w') as f:
        f.write(content)
