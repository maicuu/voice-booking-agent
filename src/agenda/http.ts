import {
  ErroAgenda,
  type AgendaClient,
  type CodigoErro,
  type ConsultaDisponibilidade,
  type Disponibilidade,
  type Estabelecimento,
  type JanelaDoDia,
  type PedidoAgendamento,
  type Profissional,
  type ResultadoEscrita,
  type Servico,
} from "./tipos.ts";
import { diaDaSemana } from "./datas.ts";

/**
 * Implementacao de `AgendaClient` contra a API do AgendaFacil (ADR 0003).
 *
 * Esta e a unica camada do projeto que conhece o formato bruto do outro lado —
 * `_id`, `name`, `nomeExibicao`, `horariosPorDia`. Tudo acima fala o vocabulario
 * de `tipos.ts`.
 */

export type ConfigHttp = {
  /** Ex: `http://localhost:3000/api`. Barra final e tolerada. */
  baseUrl: string;
  /**
   * A escrita exige um token do Cloudflare Turnstile, que e um desafio de
   * navegador: um processo server-side nao produz um (ADR 0003). Em
   * desenvolvimento o AgendaFacil roda com a secret de teste da Cloudflare, que
   * aprova qualquer token, e este marcador basta.
   *
   * Nao ha valor deste campo que funcione contra a API em producao. Isso e
   * intencional: a Fase 1 nao escreve em producao.
   */
  tokenDesafio: string;
  /** Teto por requisicao. Estourar vira desfecho incerto na escrita (ADR 0005). */
  timeoutMs?: number;
  /**
   * A configuracao do estabelecimento muda em escala de dias, e cada turno da
   * conversa precisa dela para traduzir nome em id. Sem cache, seria uma
   * chamada de rede por turno dentro do orcamento de latencia.
   */
  cacheConfigMs?: number;
  /** Injetavel para teste. Por padrao, o `fetch` global. */
  fetch?: typeof globalThis.fetch;
};

type Bruto = Record<string, unknown>;

export class AgendaHttp implements AgendaClient {
  readonly #baseUrl: string;
  readonly #tokenDesafio: string;
  readonly #timeoutMs: number;
  readonly #cacheConfigMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #cache = new Map<string, { valor: Estabelecimento; expiraEm: number }>();

  constructor(config: ConfigHttp) {
    this.#baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.#tokenDesafio = config.tokenDesafio;
    this.#timeoutMs = config.timeoutMs ?? 8000;
    this.#cacheConfigMs = config.cacheConfigMs ?? 60_000;
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  async estabelecimento(slug: string): Promise<Estabelecimento> {
    const emCache = this.#cache.get(slug);
    if (emCache && emCache.expiraEm > Date.now()) return emCache.valor;

    const bruto = await this.#pedir<Bruto>("GET", `/config/${encodeURIComponent(slug)}`);
    const valor = traduzirEstabelecimento(slug, bruto);
    this.#cache.set(slug, { valor, expiraEm: Date.now() + this.#cacheConfigMs });
    return valor;
  }

  async disponibilidade(consulta: ConsultaDisponibilidade): Promise<Disponibilidade> {
    const busca = new URLSearchParams({
      barberId: consulta.profissionalId,
      serviceId: consulta.servicoId,
      date: consulta.data,
    });
    const horarios = await this.#pedir<unknown>("GET", `/slots?${busca}`);
    if (!Array.isArray(horarios)) {
      throw new ErroAgenda("indisponivel", "Resposta de horarios em formato inesperado.");
    }
    if (horarios.length > 0) {
      return { tipo: "horarios", horarios: horarios.map(String) };
    }
    // `[]` e ambiguo na API: dia fechado e dia lotado respondem igual. Quem
    // resolve e o chamador, que tem a janela da semana; aqui so nao se pode
    // afirmar "lotado" sem essa informacao.
    return { tipo: "lotado" };
  }

  async agendar(pedido: PedidoAgendamento): Promise<ResultadoEscrita> {
    const corpo = {
      barberId: pedido.profissionalId,
      serviceId: pedido.servicoId,
      clientName: pedido.nomeCliente,
      clientPhone: pedido.telefoneCliente,
      date: pedido.data,
      slot: pedido.hora,
      cfToken: this.#tokenDesafio,
    };

    try {
      await this.#pedir<Bruto>("POST", "/schedule", corpo);
      return { estado: "confirmado" };
    } catch (erro) {
      if (!(erro instanceof ErroAgenda)) {
        return { estado: "incerto", causa: String(erro) };
      }
      // Um 4xx e uma decisao completa do servidor: ele avaliou e recusou, entao
      // esta estabelecido que nada foi escrito. Um 5xx ou uma falha de rede nao
      // dizem nada sobre o efeito, e o desfecho e incerto (ADR 0005).
      //
      // A excecao e o 503: a API so o devolve quando a consulta ao Google falha,
      // o que acontece antes da escrita. Ela declara isso na propria mensagem
      // ("tente novamente em instantes"). Tratar como recusa evita degradar a
      // conversa a cada instabilidade do Google — ao custo de depender de esse
      // 503 continuar significando o mesmo. O teste de contrato guarda isso.
      if (erro.codigo === "indisponivel") {
        return { estado: "incerto", causa: erro.message };
      }
      return { estado: "recusado", codigo: erro.codigo, motivo: erro.message };
    }
  }

  async #pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const requisicao: RequestInit = {
      method: metodo,
      signal: AbortSignal.timeout(this.#timeoutMs),
    };
    if (corpo !== undefined) {
      requisicao.headers = { "Content-Type": "application/json" };
      requisicao.body = JSON.stringify(corpo);
    }

    let resposta: Response;
    try {
      resposta = await this.#fetch(`${this.#baseUrl}${caminho}`, requisicao);
    } catch (causa) {
      // Timeout, DNS, conexao recusada: nao houve resposta, e portanto nao se
      // sabe se a requisicao teve efeito do outro lado.
      const detalhe = causa instanceof Error ? causa.message : String(causa);
      throw new ErroAgenda("indisponivel", `Nao foi possivel falar com a agenda: ${detalhe}`);
    }

    const texto = await resposta.text();
    let dados: unknown = undefined;
    if (texto.length > 0) {
      try {
        dados = JSON.parse(texto);
      } catch {
        // A API responde 404 de rota inexistente em JSON de proposito, mas o
        // servidor de arquivos estaticos na frente dela pode devolver HTML. Ler
        // isso como sucesso seria pior que falhar aqui.
        throw new ErroAgenda(
          resposta.ok ? "indisponivel" : classificar(resposta.status, undefined),
          `Resposta nao-JSON da agenda (HTTP ${resposta.status}).`,
          resposta.status,
        );
      }
    }

    if (!resposta.ok) {
      const objeto = (dados ?? {}) as Bruto;
      const mensagem = typeof objeto["error"] === "string" ? objeto["error"] : `HTTP ${resposta.status}`;
      throw new ErroAgenda(classificar(resposta.status, objeto), mensagem, resposta.status);
    }

    return dados as T;
  }
}

function classificar(status: number, corpo: Bruto | undefined): CodigoErro {
  switch (status) {
    case 400:
      // O AgendaFacil usa 400 para dois casos diferentes: requisicao malformada,
      // que vem com `detalhes` do validador de campos, e recusa por regra de
      // negocio (fora do expediente, pausa, bloqueio, antecedencia de 2h), que
      // vem so com `error`. Sao coisas distintas para o agente: a primeira e bug
      // do agente, a segunda e informacao para dar ao cliente.
      return corpo && "detalhes" in corpo ? "dados_invalidos" : "regra_de_negocio";
    case 403:
      return "dados_invalidos";
    case 404:
      return "nao_encontrado";
    case 409:
      return "slot_ocupado";
    case 429:
      return "limite_excedido";
    case 503:
      return "agenda_indisponivel";
    default:
      return status >= 500 ? "indisponivel" : "dados_invalidos";
  }
}

function traduzirEstabelecimento(slug: string, bruto: Bruto): Estabelecimento {
  const profissionais = lista(bruto["barbers"]).map(traduzirProfissional);
  const servicos = lista(bruto["services"]).map(traduzirServico);
  return {
    slug,
    nome: texto(bruto["nome"]) ?? slug,
    profissionais,
    servicos,
    semana: traduzirSemana(bruto["horariosPorDia"]),
  };
}

function traduzirProfissional(bruto: Bruto): Profissional {
  return {
    id: String(bruto["_id"] ?? ""),
    nome: texto(bruto["name"]) ?? "",
    servicoIds: listaDeIds(bruto["serviceIds"]),
    // A rota publica troca o token OAuth por este booleano. Sem ele o
    // profissional nao tem agenda consultavel nem escrevivel.
    agendaConectada: bruto["googleConectado"] === true,
  };
}

function traduzirServico(bruto: Bruto): Servico {
  return {
    id: String(bruto["_id"] ?? ""),
    nome: texto(bruto["nomeExibicao"]) ?? texto(bruto["nomeId"]) ?? "",
    preco: Number(bruto["preco"] ?? 0),
    // O AgendaFacil usa 45 minutos quando o servico nao declara duracao; a
    // geracao da grade usa 60. O agente nao escolhe: ele nunca gera horario,
    // so le `/slots`. Este campo serve para falar "leva uns 45 minutos".
    duracaoMin: Number(bruto["duracao"] ?? 45),
  };
}

function traduzirSemana(bruto: unknown): JanelaDoDia[] {
  return lista(bruto).map((dia) => ({
    diaDaSemana: Number(dia["dia"] ?? 0),
    // O campo so desliga o dia quando e explicitamente `false`; ausente conta
    // como aberto, que e como a API interpreta.
    aberto: dia["ativo"] !== false,
    abertura: texto(dia["abertura"]) ?? "00:00",
    ultimoAgendamento: texto(dia["ultimoAgendamento"]) ?? "00:00",
  }));
}

function lista(valor: unknown): Bruto[] {
  return Array.isArray(valor) ? (valor.filter((v) => v && typeof v === "object") as Bruto[]) : [];
}

/**
 * `serviceIds` chega como lista de identificadores, nao de objetos — o Mongo os
 * serializa como string quando o documento nao vem populado, e como objeto
 * quando vem. Aceitar as duas formas evita que o vinculo entre profissional e
 * servico suma de acordo com o humor da consulta do outro lado.
 */
function listaDeIds(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((v) => (v && typeof v === "object" ? String((v as Bruto)["_id"] ?? "") : String(v ?? "")))
    .filter((id) => id.length > 0);
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.length > 0 ? valor : undefined;
}

/**
 * Distingue "a loja nao abre nesse dia" de "abre e esta cheio". A API responde
 * `[]` para os dois (ADR 0003), e o cliente HTTP sozinho nao tem como saber —
 * quem sabe e quem tem a janela da semana em maos.
 */
export function desambiguarVazio(
  disponibilidade: Disponibilidade,
  estabelecimento: Estabelecimento,
  data: string,
): Disponibilidade {
  if (disponibilidade.tipo !== "lotado") return disponibilidade;
  const janela = estabelecimento.semana.find((d) => d.diaDaSemana === diaDaSemana(data));
  return janela && !janela.aberto ? { tipo: "fechado" } : disponibilidade;
}
