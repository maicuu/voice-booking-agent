import type { PedidoAgendamento } from "../agenda/tipos.ts";

/**
 * A guarda de confirmacao (`plano.md` §6.4).
 *
 * O agente repete o que entendeu e espera confirmacao explicita antes de criar
 * o agendamento. A questao e **onde** essa regra mora.
 *
 * Escrita no prompt, ela e uma sugestao: o modelo cumpre na maioria das
 * conversas e pula em algumas, e as que ele pula sao justamente as confusas —
 * onde confirmar mais importa. Nao existe redacao de prompt que transforme isso
 * em garantia.
 *
 * Aqui ela e uma maquina de estados de dois passos que o modelo nao tem como
 * contornar, porque a ferramenta de escrita simplesmente nao aceita os dados do
 * agendamento:
 *
 *   1. `preparar` recebe os dados, valida, guarda e devolve um comprovante;
 *   2. `resgatar` aceita **so** o comprovante, e so depois de o cliente ter
 *      falado de novo.
 *
 * O segundo passo e o que importa: um comprovante emitido e resgatado no mesmo
 * turno significa que o agente leu a confirmacao em voz alta e respondeu a si
 * mesmo. A guarda recusa.
 *
 * O comprovante e um contador, nao um segredo criptografico — ele nao defende
 * contra um adversario, defende contra um modelo pulando um passo. Quem garante
 * a propriedade e a maquina de estados; o comprovante so a torna verificavel.
 */

export type ConfirmacaoPendente = {
  comprovante: string;
  pedido: PedidoAgendamento;
  /** Turno da conversa em que foi emitida. */
  turnoEmitido: number;
};

export type MotivoRecusa =
  | "sem_confirmacao_pendente"
  | "comprovante_desconhecido"
  | "cliente_ainda_nao_confirmou";

export class ConfirmacaoInvalida extends Error {
  readonly motivo: MotivoRecusa;

  constructor(motivo: MotivoRecusa, mensagem: string) {
    super(mensagem);
    this.name = "ConfirmacaoInvalida";
    this.motivo = motivo;
  }
}

export class GuardaDeConfirmacao {
  #pendente: ConfirmacaoPendente | undefined;
  #sequencia = 0;

  /**
   * Registra o que sera agendado e devolve o comprovante. Substitui qualquer
   * confirmacao pendente anterior: o cliente que corrige o horario no meio da
   * frase ("nao, sexta") invalida a leitura anterior, e manter as duas vivas
   * deixaria o agente resgatar a errada.
   */
  preparar(pedido: PedidoAgendamento, turnoAtual: number): string {
    const comprovante = `conf_${++this.#sequencia}`;
    this.#pendente = { comprovante, pedido, turnoEmitido: turnoAtual };
    return comprovante;
  }

  /**
   * Troca o comprovante pelos dados do agendamento. Lanca se a confirmacao nao
   * aconteceu de verdade.
   *
   * Consome a confirmacao: um comprovante vale uma escrita. A protecao contra
   * duplicata continua sendo a da ADR 0005 — esta so impede o segundo resgate
   * dentro da mesma conversa.
   */
  resgatar(comprovante: string, turnoAtual: number): PedidoAgendamento {
    const pendente = this.#pendente;

    if (!pendente) {
      throw new ConfirmacaoInvalida(
        "sem_confirmacao_pendente",
        "Nenhuma confirmacao foi preparada. Leia os dados para o cliente antes de agendar.",
      );
    }

    if (pendente.comprovante !== comprovante) {
      throw new ConfirmacaoInvalida(
        "comprovante_desconhecido",
        "Este comprovante nao corresponde a confirmacao pendente. Prepare a confirmacao de novo.",
      );
    }

    if (turnoAtual <= pendente.turnoEmitido) {
      throw new ConfirmacaoInvalida(
        "cliente_ainda_nao_confirmou",
        "O cliente ainda nao respondeu a confirmacao. Espere a resposta dele antes de agendar.",
      );
    }

    this.#pendente = undefined;
    return pendente.pedido;
  }

  get pendente(): ConfirmacaoPendente | undefined {
    return this.#pendente;
  }
}
