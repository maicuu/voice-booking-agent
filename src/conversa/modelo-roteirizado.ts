import type {
  ModeloDeLinguagem,
  PedidoAoModelo,
  RespostaDoModelo,
  ChamadaDeFerramenta,
} from "./tipos.ts";

/**
 * Modelo roteirizado: devolve respostas escritas a mao, em ordem.
 *
 * E o que torna possivel testar a maquina de estados, a guarda de confirmacao e
 * a idempotencia sem gastar um centavo nem depender de rede — e, sobretudo, sem
 * depender de o modelo se comportar igual duas vezes. Um teste que chama o
 * modelo de verdade nao falha quando o codigo quebra; falha quando o modelo
 * muda de ideia.
 *
 * E o antecessor direto da camada 1 da ADR 0007: a diferenca entre este e o
 * reprodutor da suite de avaliacao e so a origem do roteiro — aqui escrito a
 * mao, la gravado de uma execucao real.
 */
export class ModeloRoteirizado implements ModeloDeLinguagem {
  readonly #roteiro: Array<RespostaDoModelo | ((pedido: PedidoAoModelo) => RespostaDoModelo)>;
  readonly #pedidos: PedidoAoModelo[] = [];
  #posicao = 0;

  constructor(
    roteiro: Array<RespostaDoModelo | ((pedido: PedidoAoModelo) => RespostaDoModelo)>,
  ) {
    this.#roteiro = roteiro;
  }

  /** Os pedidos recebidos, para o teste afirmar o que foi enviado ao modelo. */
  get pedidos(): readonly PedidoAoModelo[] {
    return this.#pedidos;
  }

  get chamadasRestantes(): number {
    return this.#roteiro.length - this.#posicao;
  }

  async responder(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    this.#pedidos.push(pedido);
    const proxima = this.#roteiro[this.#posicao++];
    if (proxima === undefined) {
      // Falhar alto: um roteiro curto demais significa que o codigo chamou o
      // modelo mais vezes que o teste previu, e isso e exatamente o tipo de
      // regressao que interessa pegar.
      throw new Error(
        `Roteiro esgotado na chamada ${this.#posicao}. O orquestrador pediu mais turnos que o previsto.`,
      );
    }
    return typeof proxima === "function" ? proxima(pedido) : proxima;
  }
}

/** Resposta de texto puro, sem ferramenta. */
export function fala(texto: string): RespostaDoModelo {
  return { texto, chamadas: [], uso: { entrada: 0, saida: 0 } };
}

/** Resposta que chama ferramentas. */
export function usa(
  chamadas: Array<{ nome: string; argumentos?: Record<string, unknown> }>,
  texto = "",
): RespostaDoModelo {
  return {
    texto,
    chamadas: chamadas.map((c, i): ChamadaDeFerramenta => ({
      id: `tu_${i + 1}`,
      nome: c.nome,
      argumentos: c.argumentos ?? {},
    })),
    uso: { entrada: 0, saida: 0 },
  };
}

/** Lê o conteúdo devolvido por uma ferramenta no último resultado da transcrição. */
export function ultimoResultado(pedido: PedidoAoModelo, nome?: string): unknown {
  for (let i = pedido.transcricao.length - 1; i >= 0; i--) {
    const entrada = pedido.transcricao[i];
    if (entrada?.tipo !== "ferramentas") continue;
    const anterior = pedido.transcricao[i - 1];
    for (const resultado of entrada.resultados) {
      if (nome && anterior?.tipo === "agente") {
        const chamada = anterior.chamadas.find((c) => c.id === resultado.id);
        if (chamada?.nome !== nome) continue;
      }
      return JSON.parse(resultado.conteudo);
    }
  }
  return undefined;
}
