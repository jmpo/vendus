#!/usr/bin/env python3
"""Phase 10: Translate residual PT-BR strings in seller/lead components."""
import os, re, sys
from pathlib import Path

# Pattern replacements (case-sensitive, whole-word where possible)
REPLACEMENTS = [
    # Pronouns / common
    (r"\bVocê\b", "Tú"),
    (r"\bvocê\b", "tú"),
    (r"\bSeu\b", "Tu"), (r"\bseu\b", "tu"),
    (r"\bSua\b", "Tu"), (r"\bsua\b", "tu"),
    (r"\bSeus\b", "Tus"), (r"\bseus\b", "tus"),
    (r"\bSuas\b", "Tus"), (r"\bsuas\b", "tus"),
    # Status / actions
    (r"\bCarregando\b", "Cargando"), (r"\bcarregando\b", "cargando"),
    (r"\bSucesso\b", "Éxito"), (r"\bsucesso\b", "éxito"),
    (r"\bErro\b", "Error"), (r"\berro\b", "error"),
    (r"\bAviso\b", "Aviso"),
    (r"\bAtenção\b", "Atención"), (r"\batenção\b", "atención"),
    (r"\bSalvar\b", "Guardar"), (r"\bsalvar\b", "guardar"),
    (r"\bSalvo\b", "Guardado"), (r"\bsalvo\b", "guardado"),
    (r"\bSalvando\b", "Guardando"), (r"\bsalvando\b", "guardando"),
    (r"\bExcluir\b", "Eliminar"), (r"\bexcluir\b", "eliminar"),
    (r"\bExcluído\b", "Eliminado"), (r"\bexcluído\b", "eliminado"),
    (r"\bExcluída\b", "Eliminada"), (r"\bexcluída\b", "eliminada"),
    (r"\bRemover\b", "Quitar"), (r"\bremover\b", "quitar"),
    (r"\bAdicionar\b", "Agregar"), (r"\badicionar\b", "agregar"),
    (r"\bAdicionado\b", "Agregado"), (r"\badicionado\b", "agregado"),
    (r"\bAdicionada\b", "Agregada"), (r"\badicionada\b", "agregada"),
    (r"\bEditar\b", "Editar"),
    (r"\bFechar\b", "Cerrar"), (r"\bfechar\b", "cerrar"),
    (r"\bAbrir\b", "Abrir"),
    (r"\bEnviar\b", "Enviar"),
    (r"\bEnviado\b", "Enviado"), (r"\benviado\b", "enviado"),
    (r"\bEnviada\b", "Enviada"), (r"\benviada\b", "enviada"),
    (r"\bEnviando\b", "Enviando"), (r"\benviando\b", "enviando"),
    (r"\bReceber\b", "Recibir"), (r"\breceber\b", "recibir"),
    (r"\bRecebido\b", "Recibido"), (r"\brecebido\b", "recibido"),
    (r"\bRecebida\b", "Recibida"), (r"\brecebida\b", "recibida"),
    (r"\bBuscar\b", "Buscar"),
    (r"\bPesquisar\b", "Buscar"), (r"\bpesquisar\b", "buscar"),
    (r"\bPesquisa\b", "Búsqueda"), (r"\bpesquisa\b", "búsqueda"),
    (r"\bFiltrar\b", "Filtrar"),
    (r"\bAplicar\b", "Aplicar"),
    (r"\bCancelar\b", "Cancelar"),
    (r"\bConfirmar\b", "Confirmar"),
    (r"\bAtualizar\b", "Actualizar"), (r"\batualizar\b", "actualizar"),
    (r"\bAtualizado\b", "Actualizado"), (r"\batualizado\b", "actualizado"),
    (r"\bAtualizada\b", "Actualizada"), (r"\batualizada\b", "actualizada"),
    (r"\bAtualizando\b", "Actualizando"), (r"\batualizando\b", "actualizando"),
    (r"\bCriar\b", "Crear"), (r"\bcriar\b", "crear"),
    (r"\bCriado\b", "Creado"), (r"\bcriado\b", "creado"),
    (r"\bCriada\b", "Creada"), (r"\bcriada\b", "creada"),
    (r"\bCriando\b", "Creando"), (r"\bcriando\b", "creando"),
    # Domain
    (r"\bCliente\b", "Cliente"),
    (r"\bClientes\b", "Clientes"),
    (r"\bAtendimento\b", "Atención"), (r"\batendimento\b", "atención"),
    (r"\bAtendimentos\b", "Atenciones"), (r"\batendimentos\b", "atenciones"),
    (r"\bMensagem\b", "Mensaje"), (r"\bmensagem\b", "mensaje"),
    (r"\bMensagens\b", "Mensajes"), (r"\bmensagens\b", "mensajes"),
    (r"\bConfigurações\b", "Configuración"), (r"\bconfigurações\b", "configuración"),
    (r"\bConfiguração\b", "Configuración"), (r"\bconfiguração\b", "configuración"),
    (r"\bTelefone\b", "Teléfono"), (r"\btelefone\b", "teléfono"),
    (r"\bEndereço\b", "Dirección"), (r"\bendereço\b", "dirección"),
    (r"\bUsuário\b", "Usuario"), (r"\busuário\b", "usuario"),
    (r"\bUsuários\b", "Usuarios"), (r"\busuários\b", "usuarios"),
    (r"\bSenha\b", "Contraseña"), (r"\bsenha\b", "contraseña"),
    (r"\bEsqueceu\b", "Olvidaste"), (r"\besqueceu\b", "olvidaste"),
    (r"\bEntrar\b", "Ingresar"), (r"\bentrar\b", "ingresar"),
    (r"\bSair\b", "Salir"), (r"\bsair\b", "salir"),
    (r"\bPróximo\b", "Siguiente"), (r"\bpróximo\b", "siguiente"),
    (r"\bPróxima\b", "Siguiente"), (r"\bpróxima\b", "siguiente"),
    (r"\bAnterior\b", "Anterior"),
    (r"\bÚltimo\b", "Último"), (r"\búltimo\b", "último"),
    (r"\bÚltima\b", "Última"), (r"\búltima\b", "última"),
    (r"\bFunil\b", "Embudo"), (r"\bfunil\b", "embudo"),
    (r"\bFunis\b", "Embudos"), (r"\bfunis\b", "embudos"),
    (r"\bFluxo\b", "Flujo"), (r"\bfluxo\b", "flujo"),
    (r"\bFluxos\b", "Flujos"), (r"\bfluxos\b", "flujos"),
    (r"\bAgendamento\b", "Reserva"), (r"\bagendamento\b", "reserva"),
    (r"\bAgendamentos\b", "Reservas"), (r"\bagendamentos\b", "reservas"),
    (r"\bAgendar\b", "Agendar"), (r"\bagendar\b", "agendar"),
    (r"\bFunção\b", "Rol"), (r"\bfunção\b", "rol"),
    (r"\bEquipe\b", "Equipo"), (r"\bequipe\b", "equipo"),
    (r"\bGrupo\b", "Grupo"),
    (r"\bEmpresa\b", "Empresa"),
    (r"\bProduto\b", "Producto"), (r"\bproduto\b", "producto"),
    (r"\bProdutos\b", "Productos"), (r"\bprodutos\b", "productos"),
    (r"\bVenda\b", "Venta"), (r"\bvenda\b", "venta"),
    (r"\bVendas\b", "Ventas"), (r"\bvendas\b", "ventas"),
    (r"\bPedido\b", "Pedido"),
    (r"\bPedidos\b", "Pedidos"),
    # Phrases
    (r"\bcom sucesso\b", "con éxito"),
    (r"\bao salvar\b", "al guardar"),
    (r"\bao criar\b", "al crear"),
    (r"\bao excluir\b", "al eliminar"),
    (r"\bao atualizar\b", "al actualizar"),
    (r"\bao enviar\b", "al enviar"),
    (r"\bao carregar\b", "al cargar"),
    (r"\bNenhum\b", "Ninguno"), (r"\bnenhum\b", "ninguno"),
    (r"\bNenhuma\b", "Ninguna"), (r"\bnenhuma\b", "ninguna"),
    (r"\bencontrado\b", "encontrado"),
    (r"\bencontrada\b", "encontrada"),
    (r"\bnão encontrado\b", "no encontrado"),
    (r"\bnão encontrada\b", "no encontrada"),
    (r"\bnão\b", "no"), (r"\bNão\b", "No"),
    (r"\bsim\b", "sí"), (r"\bSim\b", "Sí"),
    (r"\bou\b", "o"),
    (r"\bMais\b", "Más"), (r"\bmais\b", "más"),
    (r"\bMenos\b", "Menos"), (r"\bmenos\b", "menos"),
    (r"\bHoje\b", "Hoy"), (r"\bhoje\b", "hoy"),
    (r"\bOntem\b", "Ayer"), (r"\bontem\b", "ayer"),
    (r"\bAmanhã\b", "Mañana"), (r"\bamanhã\b", "mañana"),
    (r"\bAgora\b", "Ahora"), (r"\bagora\b", "ahora"),
    (r"\bDepois\b", "Después"), (r"\bdepois\b", "después"),
    (r"\bAntes\b", "Antes"),
    (r"\bSemana\b", "Semana"), (r"\bsemana\b", "semana"),
    (r"\bMês\b", "Mes"), (r"\bmês\b", "mes"),
    (r"\bAno\b", "Año"), (r"\bano\b", "año"),
    (r"\bDia\b", "Día"), (r"\bdia\b", "día"),
    (r"\bDias\b", "Días"), (r"\bdias\b", "días"),
    (r"\bHora\b", "Hora"),
    (r"\bMinuto\b", "Minuto"), (r"\bminuto\b", "minuto"),
    (r"\bSegundo\b", "Segundo"), (r"\bsegundo\b", "segundo"),
]

EXTS = (".tsx", ".ts")
ROOTS = ["src/components/seller", "src/components/lead"]

def should_skip_line(line: str) -> bool:
    # Skip imports, exports of identifiers
    s = line.strip()
    if s.startswith(("import ", "export {", "from '", 'from "')):
        return True
    return False

def translate_file(path: Path):
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return False
    orig = text
    # Apply only inside string literals and JSX text. Simple heuristic: apply globally
    # but skip import lines.
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        if should_skip_line(ln):
            continue
        new = ln
        for pat, rep in REPLACEMENTS:
            new = re.sub(pat, rep, new)
        lines[i] = new
    new_text = "\n".join(lines)
    if new_text != orig:
        path.write_text(new_text, encoding="utf-8")
        return True
    return False

count = 0
for root in ROOTS:
    for p in Path(root).rglob("*"):
        if p.is_file() and p.suffix in EXTS:
            if translate_file(p):
                count += 1
                print(f"  ✓ {p}")
print(f"\nTotal files updated: {count}")
