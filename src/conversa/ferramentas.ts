import { desambiguarVazio } from "../agenda/http.ts";
import { agendarComIdempotencia, type RegistroDeIntencao } from "../agenda/idempotencia.ts";
import { dataPorExtenso, ehData, ehHora, nomeDoDia } from "../agenda/datas.ts";
import { normalizarTelefone } from "../agenda/telefone.ts";
import {
  ErroAgenda,
  type AgendaClient,
  type Estabelecimento,
  type PedidoAgendamento,
  type Profissional,
} from "../agenda/tipos.ts";
import { ConfirmacaoInvalida, GuardaDeConfirmacao } from "./confirmacao.ts";
import type { ChamadaDeFerramenta, DefinicaoDeFerramenta, ResultadoDeFerramenta } from "./tipos.ts";

/**
 * As ferramentas que o modelo enxerga, e o despachante que as executa.
 *
 * Esta e a fronteira da ADR 0001 em codigo: toda pergunta com resposta objetiva
 * — que servicos existem, quanto custa, quem atende, tem horario quinta — e uma
 * ferramenta. O modelo interpreta a fala e preenche os argumentos; a resposta
 * vem daqui. Pergunta sem ferramenta correspondente e recusa explicita, nao
 * improviso.
 */

export type ContextoDeFerramentas = {
  cliente: AgendaClient;
  slug: string;
  registro: RegistroDeIntencao;
  guarda: GuardaDeConfirmacao;
  /** Turno atual da conversa, para a guarda de confirmacao. */
  turnoAtual: () => number;
};

export const FERRAMENTAS: DefinicaoDeFerramenta[] = [
  {
    nome: "listar_servicos",
    descricao:
      "Lista os servicos que a barbearia oferece, com preco e duracao. Chame antes de " +
      "falar qualquer preco ou nome de servico ao cliente. Nunca diga um preco que nao " +
      "tenha vindo desta ferramenta.",
    esquema: { type: "object", properties: {}, required: [] },
  },
  {
    nome: "listar_profissionais",
    descricao:
      "Lista os profissionais que atendem e podem receber agendamento. Chame quando o " +
      "cliente perguntar quem atende, ou quando pedir um profissional pelo nome e voce " +
      "precisar do identificador dele.",
    esquema: { type: "object", properties: {}, required: [] },
  },
  {
    nome: "consultar_horarios",
    descricao:
      "Consulta os horarios livres de um dia. Esta e a unica forma de saber se existe " +
      "vaga: nunca afirme, deduza ou estime disponibilidade sem chamar esta ferramenta. " +
      "Omita profissional_id para consultar todos de uma vez, que e o caso comum quando " +
      "o cliente nao escolheu com quem quer se atender.",
    esquema: {
      type: "object",
      properties: {
        servico_id: { type: "string", description: "Identificador vindo de listar_servicos." },
        data: { type: "string", description: "Data no formato AAAA-MM-DD." },
        profissional_id: {
          type: "string",
          description: "Opcional. Identificador vindo de listar_profissionais.",
        },
      },
      required: ["servico_id", "data"],
    },
  },
  {
    nome: "preparar_confirmacao",
    descricao:
      "Primeiro dos dois passos para agendar. Registra o que sera agendado e devolve a " +
      "frase exata para voce ler ao cliente, mais um comprovante. Depois de chamar, leia " +
      "a frase e espere o cliente confirmar. Nao agende no mesmo turno.",
    esquema: {
      type: "object",
      properties: {
        servico_id: { type: "string" },
        profissional_id: { type: "string" },
        data: { type: "string", description: "AAAA-MM-DD." },
        hora: { type: "string", description: "HH:MM, exatamente um dos horarios livres." },
        nome_cliente: { type: "string" },
        telefone_cliente: {
          type: "string",
          description: "Celular com DDD. So digitos ou formatado, tanto faz.",
        },
      },
      required: [
        "servico_id",
        "profissional_id",
        "data",
        "hora",
        "nome_cliente",
        "telefone_cliente",
      ],
    },
  },
  {
    nome: "agendar",
    descricao:
      "Segundo passo. Cria o agendamento de verdade. So aceita o comprovante de " +
      "preparar_confirmacao, e so depois de o cliente ter respondido confirmando. " +
      "Esta acao tem efeito irreversivel na agenda do profissional.",
    esquema: {
      type: "object",
      properties: {
        comprovante: { type: "string", description: "Devolvido por preparar_confirmacao." },
      },
      required: ["comprovante"],
    },
  },
];

export async function executar(
  chamada: ChamadaDeFerramenta,
  contexto: ContextoDeFerramentas,
): Promise<ResultadoDeFerramenta> {
  try {
    const conteudo = await despachar(chamada, contexto);
    return { id: chamada.id, conteudo: JSON.stringify(conteudo) };
  } catch (erro) {
    // O erro volta para o modelo como resultado, nao como excecao: ele precisa
    // saber que a chamada falhou para dizer algo ao cliente (`plano.md` §6.5).
    // Silenciar aqui produziria o pior desfecho possivel — o agente seguindo a
    // conversa como se tivesse a informacao.
    return { id: chamada.id, conteudo: JSON.stringify(traduzirErro(erro)), erro: true };
  }
}

async function despachar(
  chamada: ChamadaDeFerramenta,
  contexto: ContextoDeFerramentas,
): Promise<unknown> {
  const args = chamada.argumentos;

  switch (chamada.nome) {
    case "listar_servicos": {
      const est = await contexto.cliente.estabelecimento(contexto.slug);
      return {
        estabelecimento: est.nome,
        servicos: est.servicos.map((s) => ({
          id: s.id,
          nome: s.nome,
          preco_reais: s.preco,
          duracao_minutos: s.duracaoMin,
        })),
      };
    }

    case "listar_profissionais": {
      const est = await contexto.cliente.estabelecimento(contexto.slug);
      return {
        profissionais: atendentes(est).map((p) => ({
          id: p.id,
          nome: p.nome,
          servico_ids: p.servicoIds,
        })),
      };
    }

    case "consultar_horarios":
      return consultarHorarios(args, contexto);

    case "preparar_confirmacao":
      return prepararConfirmacao(args, contexto);

    case "agendar":
      return agendar(args, contexto);

    default:
      return { erro: "ferramenta_desconhecida", ferramenta: chamada.nome };
  }
}

async function consultarHorarios(
  args: Record<string, unknown>,
  contexto: ContextoDeFerramentas,
): Promise<unknown> {
  const data = String(args["data"] ?? "");
  const servicoId = String(args["servico_id"] ?? "");
  if (!ehData(data)) return { erro: "data_invalida", esperado: "AAAA-MM-DD", recebido: data };

  const est = await contexto.cliente.estabelecimento(contexto.slug);
  const servico = est.servicos.find((s) => s.id === servicoId);
  if (!servico) {
    return { erro: "servico_desconhecido", dica: "Chame listar_servicos e use um id de la." };
  }

  const escolhido = args["profissional_id"] ? String(args["profissional_id"]) : undefined;
  const alvos = escolhido
    ? atendentes(est).filter((p) => p.id === escolhido)
    : atendentes(est).filter((p) => atende(p, servicoId));

  if (alvos.length === 0) {
    return escolhido
      ? { erro: "profissional_desconhecido", dica: "Chame listar_profissionais." }
      : { data, situacao: "sem_profissional", detalhe: "Ninguem atende esse servico." };
  }

  // O leque da ADR 0003: uma chamada por profissional, em paralelo. Em serie a
  // soma sairia do orcamento de latencia; e o custo dominante e a consulta ao
  // Google dentro da API, que nao muda com o numero de profissionais.
  const consultas = await Promise.all(
    alvos.map(async (p) => {
      const bruta = await contexto.cliente.disponibilidade({
        profissionalId: p.id,
        servicoId,
        data,
      });
      return { profissional: p, disponibilidade: desambiguarVazio(bruta, est, data) };
    }),
  );

  if (consultas.every((c) => c.disponibilidade.tipo === "fechado")) {
    return { data, dia: nomeDoDia(data), situacao: "fechado" };
  }

  const comHorarios = consultas
    .filter((c) => c.disponibilidade.tipo === "horarios")
    .map((c) => ({
      profissional_id: c.profissional.id,
      profissional: c.profissional.nome,
      horarios: c.disponibilidade.tipo === "horarios" ? c.disponibilidade.horarios : [],
    }));

  if (comHorarios.length === 0) {
    return { data, dia: nomeDoDia(data), situacao: "lotado" };
  }

  return {
    data,
    dia: nomeDoDia(data),
    situacao: "com_horarios",
    servico: servico.nome,
    disponibilidade: comHorarios,
  };
}

async function prepararConfirmacao(
  args: Record<string, unknown>,
  contexto: ContextoDeFerramentas,
): Promise<unknown> {
  const data = String(args["data"] ?? "");
  const hora = String(args["hora"] ?? "");
  const nome = String(args["nome_cliente"] ?? "").trim();

  if (!ehData(data)) return { erro: "data_invalida", esperado: "AAAA-MM-DD", recebido: data };
  if (!ehHora(hora)) return { erro: "hora_invalida", esperado: "HH:MM", recebido: hora };
  if (nome.length < 2) return { erro: "nome_invalido", dica: "Pergunte o nome do cliente." };

  // Recusar aqui, e nao no POST, e o que evita ler uma confirmacao inteira em voz
  // alta para so entao descobrir que a API rejeita o telefone.
  const telefone = normalizarTelefone(String(args["telefone_cliente"] ?? ""));
  if (!telefone) {
    return {
      erro: "telefone_invalido",
      dica: "Peca o celular com DDD, incluindo o 9. A barbearia usa esse numero para confirmar.",
    };
  }

  const est = await contexto.cliente.estabelecimento(contexto.slug);
  const servico = est.servicos.find((s) => s.id === String(args["servico_id"] ?? ""));
  const profissional = atendentes(est).find((p) => p.id === String(args["profissional_id"] ?? ""));
  if (!servico) return { erro: "servico_desconhecido", dica: "Chame listar_servicos." };
  if (!profissional) return { erro: "profissional_desconhecido", dica: "Chame listar_profissionais." };

  const pedido: PedidoAgendamento = {
    profissionalId: profissional.id,
    servicoId: servico.id,
    data,
    hora,
    nomeCliente: nome,
    telefoneCliente: telefone,
  };

  const comprovante = contexto.guarda.preparar(pedido, contexto.turnoAtual());

  return {
    comprovante,
    frase_para_ler:
      `${servico.nome} com ${profissional.nome}, ${dataPorExtenso(data)} as ${hora}, ` +
      `no nome de ${nome}. Posso confirmar?`,
    proximo_passo:
      "Leia a frase para o cliente e espere a resposta dele. So chame agendar depois disso.",
  };
}

async function agendar(
  args: Record<string, unknown>,
  contexto: ContextoDeFerramentas,
): Promise<unknown> {
  let pedido: PedidoAgendamento;
  try {
    pedido = contexto.guarda.resgatar(String(args["comprovante"] ?? ""), contexto.turnoAtual());
  } catch (erro) {
    if (erro instanceof ConfirmacaoInvalida) {
      return { erro: erro.motivo, detalhe: erro.message };
    }
    throw erro;
  }

  const resultado = await agendarComIdempotencia(contexto.cliente, contexto.registro, pedido);

  switch (resultado.estado) {
    case "confirmado":
      return {
        situacao: "agendado",
        ja_existia: resultado.reaproveitado,
        detalhe: `${dataPorExtenso(pedido.data)} as ${pedido.hora}.`,
      };
    case "recusado":
      return { situacao: "recusado", motivo: resultado.motivo, codigo: resultado.codigo };
    case "incerto":
      // A ADR 0005 em uma linha: nao afirmar o que a API nao confirmou.
      return {
        situacao: "incerto",
        detalhe: resultado.causa,
        instrucao:
          "Nao diga que agendou. Diga ao cliente que nao foi possivel confirmar e peca " +
          "que ele confirme direto com a barbearia.",
      };
  }
}

/** Profissional sem agenda conectada nao pode ser consultado nem agendado (ADR 0003). */
function atendentes(est: Estabelecimento): Profissional[] {
  return est.profissionais.filter((p) => p.agendaConectada);
}

/** Lista vazia de servicos significa "atende todos", como no AgendaFacil. */
function atende(profissional: Profissional, servicoId: string): boolean {
  return profissional.servicoIds.length === 0 || profissional.servicoIds.includes(servicoId);
}

function traduzirErro(erro: unknown): Record<string, unknown> {
  if (erro instanceof ErroAgenda) {
    return {
      erro: erro.codigo,
      detalhe: erro.message,
      instrucao:
        erro.codigo === "agenda_indisponivel" || erro.codigo === "indisponivel"
          ? "A agenda nao respondeu. Diga isso ao cliente e ofereca tentar de novo em instantes."
          : "Explique ao cliente com as suas palavras e ofereca uma alternativa.",
    };
  }
  return {
    erro: "falha_inesperada",
    detalhe: erro instanceof Error ? erro.message : String(erro),
    instrucao: "Nao repita esta mensagem ao cliente. Encerre com elegancia.",
  };
}
