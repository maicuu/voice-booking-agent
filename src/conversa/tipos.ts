/**
 * Contrato com o modelo de linguagem (ADR 0006).
 *
 * Nada acima desta fronteira sabe que existe Anthropic do outro lado. A
 * interface tem dois motivos para existir, e o segundo é o que quase sempre
 * some quando alguém "simplifica" uma camada dessas:
 *
 *   1. trocar de provedor sem tocar na maquina de estados;
 *   2. **gravar e reproduzir** o dialogo, que e o que torna a camada 1 da suite
 *      de avaliacao possivel (ADR 0007). Sem essa fronteira, avaliar o agente
 *      custaria uma chamada de API por caso por commit.
 */

export type DefinicaoDeFerramenta = {
  nome: string;
  /**
   * O texto que o modelo le para decidir se chama a ferramenta. E o fator que
   * mais pesa no comportamento do agente: descricao vaga produz ferramenta
   * chamada na hora errada, e nenhum ajuste no prompt de sistema conserta isso.
   */
  descricao: string;
  /** JSON Schema dos argumentos. */
  esquema: Record<string, unknown>;
};

export type ChamadaDeFerramenta = {
  id: string;
  nome: string;
  argumentos: Record<string, unknown>;
};

export type ResultadoDeFerramenta = {
  id: string;
  conteudo: string;
  erro?: boolean;
};

/**
 * Um turno da transcricao. O nome `cliente` em vez de `usuario` e deliberado:
 * quem fala com este agente e cliente de uma barbearia, e o vocabulario do
 * dominio vale mais que o vocabulario da API.
 */
export type Entrada =
  | { tipo: "cliente"; texto: string }
  | { tipo: "agente"; texto: string; chamadas: ChamadaDeFerramenta[] }
  | { tipo: "ferramentas"; resultados: ResultadoDeFerramenta[] };

export type PedidoAoModelo = {
  sistema: string;
  ferramentas: DefinicaoDeFerramenta[];
  transcricao: Entrada[];
};

/** Contagem real devolvida pelo provedor. Alimenta o custo medido (ADR 0006). */
export type UsoDeTokens = {
  entrada: number;
  saida: number;
};

export type RespostaDoModelo = {
  texto: string;
  chamadas: ChamadaDeFerramenta[];
  uso: UsoDeTokens;
};

export type CodigoErroModelo =
  /** Rede, timeout, 5xx: nao se sabe se a chamada chegou. */
  | "indisponivel"
  /** Limite de requisicoes do provedor. */
  | "limite_excedido"
  /** Chave ausente ou invalida. */
  | "credencial"
  /** O modelo recusou a requisicao por politica de conteudo. */
  | "recusado"
  /** Requisicao malformada: bug do agente, nao do provedor. */
  | "requisicao_invalida";

export class ErroModelo extends Error {
  readonly codigo: CodigoErroModelo;

  constructor(codigo: CodigoErroModelo, mensagem: string) {
    super(mensagem);
    this.name = "ErroModelo";
    this.codigo = codigo;
  }
}

export interface ModeloDeLinguagem {
  responder(pedido: PedidoAoModelo): Promise<RespostaDoModelo>;
}
