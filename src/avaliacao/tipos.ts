import type { ChamadaDeFerramenta, RespostaDoModelo, UsoDeTokens } from "../conversa/tipos.ts";

/**
 * Vocabulario da suite de avaliacao (ADR 0007, `plano.md` §6.2).
 *
 * O que um caso afirma nao e o texto que o agente produz — e o que ele **fez**:
 * qual ferramenta foi chamada, com quais argumentos, e quantos agendamentos
 * existem no fim. Essa e a asserção que a ADR 0001 tornou possivel, e a unica
 * que nao quebra quando o modelo escolhe outras palavras para dizer a mesma
 * coisa.
 */

export type Expectativa = {
  /**
   * Quantos agendamentos devem existir na agenda no fim do caso. E a asserção
   * mais importante da suite: e o unico numero que o cliente sente.
   */
  agendamentos: number;
  /** Ferramentas que precisam ter sido chamadas, em qualquer ordem. */
  chamou?: string[];
  /**
   * Ferramentas que nao podem ter sido chamadas. Usado para provar recusa:
   * "vocês vendem pomada?" nao pode acabar em `preparar_confirmacao`.
   */
  naoChamou?: string[];
  /** Argumentos que uma chamada especifica precisa conter. */
  argumentosDe?: {
    ferramenta: string;
    contendo: Record<string, unknown>;
  };
  /** Se o ultimo turno deve ou nao ter terminado em degradacao. */
  degradado?: boolean;
};

export type CasoDeAvaliacao = {
  /** Identificador estavel: da nome ao arquivo de gravacao. */
  nome: string;
  /** O que o caso existe para pegar. Aparece no relatorio quando falha. */
  descricao: string;
  /** As falas do cliente, em ordem. Um turno cada. */
  falas: string[];
  espera: Expectativa;
};

export type TurnoDoCaso = {
  fala: string;
  resposta: string;
  degradado: boolean;
};

export type ResultadoDeCaso = {
  caso: string;
  passou: boolean;
  /** Uma linha por expectativa violada. Vazio quando passou. */
  falhas: string[];
  chamadas: ChamadaDeFerramenta[];
  agendamentos: number;
  turnos: TurnoDoCaso[];
  uso: UsoDeTokens;
};

export type ResumoDaSuite = {
  total: number;
  aprovados: number;
  resultados: ResultadoDeCaso[];
  uso: UsoDeTokens;
};

/**
 * Uma execucao gravada de um caso: as respostas que o modelo deu, na ordem em
 * que deu (ADR 0007, camada 1).
 */
export type Gravacao = {
  caso: string;
  /**
   * Impressao digital do prompt de sistema e das definicoes de ferramenta que
   * produziram estas respostas.
   *
   * E o que impede o pior modo de falha da camada 1: alguem muda o prompt,
   * ninguem regrava, e a suite continua verde reproduzindo um dialogo que o
   * modelo nao produz mais. Com a assinatura, "regravar quando o prompt mudar"
   * deixa de ser disciplina humana e vira falha de teste.
   */
  assinatura: string;
  gravadoEm: string;
  modelo: string;
  respostas: RespostaDoModelo[];
};
