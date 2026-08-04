import {
  type AgendaClient,
  type ConsultaDisponibilidade,
  type Data,
  type Disponibilidade,
  type Estabelecimento,
  type Hora,
  type PedidoAgendamento,
  type ResultadoEscrita,
} from "./tipos.ts";
import { diaDaSemana } from "./datas.ts";

/**
 * Duplo em memoria do sistema de agendamento (ADR 0004).
 *
 * Existe para a suite de avaliacao rodar em CI, onde nao ha MongoDB, nem conta
 * Google conectada, nem rede — e para poder injetar falhas que sao dificeis de
 * provocar contra um servidor de verdade, em especial a que importa: a escrita
 * que acontece e a resposta que nao chega (ADR 0005).
 *
 * Reproduz as regras do servidor que o agente observa: janela do dia, grade em
 * passos da duracao do servico, antecedencia minima e conflito com horario
 * ocupado. Nao reproduz pausa, bloqueio nem expediente individual — quando um
 * caso de avaliacao precisar deles, entram aqui. O que este duplo nao pode
 * virar e uma segunda implementacao da regra de negocio de onde extrair
 * conclusao: o que vale e o servidor, e o teste de contrato e quem garante que
 * os dois nao divergiram.
 */

/** Antecedencia minima que o AgendaFacil exige entre agora e o inicio do servico. */
const ANTECEDENCIA_MIN_MS = 2 * 60 * 60 * 1000;

export type FalhaInjetada =
  /** A chamada nao chega ao servidor. Nada e escrito. */
  | { tipo: "rede" }
  /**
   * A escrita acontece e a resposta se perde. E o unico cenario em que um
   * reenvio duplicaria, e o motivo pelo qual a ADR 0005 existe.
   */
  | { tipo: "escreve_e_cai" }
  /** Resposta valida de erro do servidor. */
  | { tipo: "http"; status: number; mensagem: string };

export type Agendado = {
  chaveExterna: string;
  profissionalId: string;
  servicoId: string;
  data: Data;
  hora: Hora;
  nomeCliente: string;
  telefoneCliente: string;
};

export class AgendaEmMemoria implements AgendaClient {
  readonly #estabelecimento: Estabelecimento;
  readonly #agendados: Agendado[] = [];
  #falhas: FalhaInjetada[] = [];
  #agora: () => number;
  #sequencia = 0;

  constructor(estabelecimento: Estabelecimento, agora: () => number = Date.now) {
    this.#estabelecimento = estabelecimento;
    this.#agora = agora;
  }

  /** Enfileira falhas, uma por chamada de escrita, na ordem. */
  injetarFalhas(...falhas: FalhaInjetada[]): void {
    this.#falhas.push(...falhas);
  }

  /** O que existe na agenda. A suite verifica contagem aqui, nao no texto do agente. */
  get agendados(): readonly Agendado[] {
    return this.#agendados;
  }

  /** Move o relogio do duplo, para casos que dependem da antecedencia de 2h. */
  definirAgora(agora: () => number): void {
    this.#agora = agora;
  }

  async estabelecimento(slug: string): Promise<Estabelecimento> {
    if (slug !== this.#estabelecimento.slug) {
      throw new ErroSimulado(404, "Unidade nao encontrada");
    }
    return this.#estabelecimento;
  }

  async disponibilidade(consulta: ConsultaDisponibilidade): Promise<Disponibilidade> {
    const profissional = this.#estabelecimento.profissionais.find((p) => p.id === consulta.profissionalId);
    const servico = this.#estabelecimento.servicos.find((s) => s.id === consulta.servicoId);
    if (!profissional || !servico) throw new ErroSimulado(404, "Dados incompletos");

    const janela = this.#estabelecimento.semana.find((d) => d.diaDaSemana === diaDaSemana(consulta.data));
    if (!janela || !janela.aberto) return { tipo: "fechado" };

    const livres = this.#grade(janela.abertura, janela.ultimoAgendamento, servico.duracaoMin).filter((hora) =>
      this.#estaLivre(consulta.profissionalId, consulta.data, hora, servico.duracaoMin),
    );

    return livres.length > 0 ? { tipo: "horarios", horarios: livres } : { tipo: "lotado" };
  }

  async agendar(pedido: PedidoAgendamento): Promise<ResultadoEscrita> {
    const falha = this.#falhas.shift();

    if (falha?.tipo === "rede") {
      return { estado: "incerto", causa: "falha de rede simulada" };
    }
    if (falha?.tipo === "http") {
      return falha.status >= 500
        ? { estado: "incerto", causa: falha.mensagem }
        : { estado: "recusado", codigo: falha.status === 409 ? "slot_ocupado" : "regra_de_negocio", motivo: falha.mensagem };
    }

    const servico = this.#estabelecimento.servicos.find((s) => s.id === pedido.servicoId);
    const profissional = this.#estabelecimento.profissionais.find((p) => p.id === pedido.profissionalId);
    if (!servico || !profissional) {
      return { estado: "recusado", codigo: "nao_encontrado", motivo: "Profissional ou servico nao encontrado" };
    }

    const janela = this.#estabelecimento.semana.find((d) => d.diaDaSemana === diaDaSemana(pedido.data));
    if (!janela || !janela.aberto) {
      return { estado: "recusado", codigo: "regra_de_negocio", motivo: "Dia nao disponivel para agendamento" };
    }
    if (!this.#respeitaAntecedencia(pedido.data, pedido.hora)) {
      return { estado: "recusado", codigo: "regra_de_negocio", motivo: "Agendamento exige 2h de antecedencia" };
    }
    if (!this.#estaLivre(pedido.profissionalId, pedido.data, pedido.hora, servico.duracaoMin)) {
      return {
        estado: "recusado",
        codigo: "slot_ocupado",
        motivo: "Este horario acabou de ser reservado. Escolha outro.",
      };
    }

    // A escrita acontece antes da decisao de responder, exatamente como no
    // servidor real. E o que torna `escreve_e_cai` uma simulacao honesta.
    this.#agendados.push({
      chaveExterna: `evt_${++this.#sequencia}`,
      profissionalId: pedido.profissionalId,
      servicoId: pedido.servicoId,
      data: pedido.data,
      hora: pedido.hora,
      nomeCliente: pedido.nomeCliente,
      telefoneCliente: pedido.telefoneCliente,
    });

    if (falha?.tipo === "escreve_e_cai") {
      return { estado: "incerto", causa: "resposta perdida apos a escrita" };
    }
    return { estado: "confirmado" };
  }

  #grade(inicio: Hora, fim: Hora, passoMin: number): Hora[] {
    const paraMin = (h: Hora) => {
      const [hh, mm] = h.split(":").map(Number);
      return (hh ?? 0) * 60 + (mm ?? 0);
    };
    const paraHora = (min: number): Hora =>
      `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

    if (!(passoMin > 0)) return [];
    const horarios: Hora[] = [];
    for (let min = paraMin(inicio); min <= paraMin(fim) && min < 24 * 60; min += passoMin) {
      horarios.push(paraHora(min));
    }
    return horarios;
  }

  #estaLivre(profissionalId: string, data: Data, hora: Hora, duracaoMin: number): boolean {
    if (!this.#respeitaAntecedencia(data, hora)) return false;
    const inicio = this.#instante(data, hora);
    const fim = inicio + duracaoMin * 60_000;
    return !this.#agendados.some((a) => {
      if (a.profissionalId !== profissionalId || a.data !== data) return false;
      const servico = this.#estabelecimento.servicos.find((s) => s.id === a.servicoId);
      const outroInicio = this.#instante(a.data, a.hora);
      const outroFim = outroInicio + (servico?.duracaoMin ?? 45) * 60_000;
      return inicio < outroFim && fim > outroInicio;
    });
  }

  #respeitaAntecedencia(data: Data, hora: Hora): boolean {
    return this.#instante(data, hora) >= this.#agora() + ANTECEDENCIA_MIN_MS;
  }

  #instante(data: Data, hora: Hora): number {
    // O AgendaFacil trabalha inteiro em -03:00, com o deslocamento escrito no
    // codigo. O duplo repete isso de proposito: se o horario de verao voltar, os
    // dois quebram junto e o teste de contrato mostra.
    return new Date(`${data}T${hora}:00-03:00`).getTime();
  }
}

class ErroSimulado extends Error {
  readonly status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.name = "ErroSimulado";
    this.status = status;
  }
}

/** Estabelecimento minimo para teste: dois profissionais, dois servicos, seg-sab. */
export function estabelecimentoDeTeste(): Estabelecimento {
  return {
    slug: "barbearia-teste",
    nome: "Barbearia de Teste",
    profissionais: [
      { id: "prof_1", nome: "Ricardo", servicoIds: [], agendaConectada: true },
      { id: "prof_2", nome: "Ana", servicoIds: ["serv_1"], agendaConectada: true },
    ],
    servicos: [
      { id: "serv_1", nome: "Corte", preco: 45, duracaoMin: 30 },
      { id: "serv_2", nome: "Corte com barba", preco: 70, duracaoMin: 60 },
    ],
    semana: [
      { diaDaSemana: 0, aberto: false, abertura: "08:00", ultimoAgendamento: "12:00" },
      { diaDaSemana: 1, aberto: true, abertura: "09:00", ultimoAgendamento: "18:00" },
      { diaDaSemana: 2, aberto: true, abertura: "09:00", ultimoAgendamento: "18:00" },
      { diaDaSemana: 3, aberto: true, abertura: "09:00", ultimoAgendamento: "18:00" },
      { diaDaSemana: 4, aberto: true, abertura: "09:00", ultimoAgendamento: "18:00" },
      { diaDaSemana: 5, aberto: true, abertura: "09:00", ultimoAgendamento: "19:00" },
      { diaDaSemana: 6, aberto: true, abertura: "09:00", ultimoAgendamento: "16:00" },
    ],
  };
}
