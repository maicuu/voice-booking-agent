import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DefinicaoDeFerramenta,
  ModeloDeLinguagem,
  PedidoAoModelo,
  RespostaDoModelo,
} from "../conversa/tipos.ts";
import type { Gravacao } from "./tipos.ts";

/**
 * Gravacao e reproducao de dialogos (ADR 0007).
 *
 * A camada 1 da suite roda `ModeloGravado`: sem rede, sem chave de API, sem
 * custo e deterministica. A camada 2 roda `ModeloGravador`, que envolve o
 * modelo de verdade e escreve o que ele respondeu.
 */

export const PASTA_DE_GRAVACOES = "avaliacao/gravacoes";

/**
 * Impressao digital do que foi enviado ao modelo. Cobre o prompt de sistema e
 * as definicoes de ferramenta — nome, descricao e esquema —, porque mudar a
 * descricao de uma ferramenta muda o comportamento do agente tanto quanto
 * mudar o prompt.
 *
 * Nao cobre a transcricao: essa varia por caso e por turno, e e o que a
 * gravacao existe para reproduzir.
 */
export function assinatura(sistema: string, ferramentas: readonly DefinicaoDeFerramenta[]): string {
  const material = JSON.stringify({
    sistema,
    // Ordenado: a ordem em que as ferramentas sao declaradas nao deveria
    // invalidar uma gravacao, e sem isso invalidaria.
    ferramentas: [...ferramentas]
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map((f) => ({ nome: f.nome, descricao: f.descricao, esquema: f.esquema })),
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export class GravacaoAusente extends Error {
  constructor(caso: string) {
    super(
      `Sem gravacao para o caso "${caso}". Rode a camada 2 (\`npm run avaliar -- --ao-vivo\`) ` +
        `para grava-la. Caso sem gravacao e falha, nao pulo: uma suite que pula o que nao ` +
        `sabe testar fica verde por nao ter testado nada.`,
    );
    this.name = "GravacaoAusente";
  }
}

export class GravacaoDesatualizada extends Error {
  constructor(caso: string, esperada: string, atual: string) {
    super(
      `A gravacao do caso "${caso}" foi feita com outro prompt ou outras ferramentas ` +
        `(assinatura ${esperada}, atual ${atual}). Regrave com \`--ao-vivo\` — reproduzir ` +
        `esta gravacao testaria um dialogo que o modelo nao produz mais.`,
    );
    this.name = "GravacaoDesatualizada";
  }
}

/** Reproduz uma gravacao. E o modelo da camada 1. */
export class ModeloGravado implements ModeloDeLinguagem {
  readonly #gravacao: Gravacao;
  #posicao = 0;

  constructor(gravacao: Gravacao) {
    this.#gravacao = gravacao;
  }

  async responder(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    const atual = assinatura(pedido.sistema, pedido.ferramentas);
    if (atual !== this.#gravacao.assinatura) {
      throw new GravacaoDesatualizada(this.#gravacao.caso, this.#gravacao.assinatura, atual);
    }

    const proxima = this.#gravacao.respostas[this.#posicao++];
    if (!proxima) {
      // O agente pediu mais turnos do que a gravacao tem. Quase sempre significa
      // que o codigo mudou de forma que altera o numero de rodadas — o que e
      // exatamente a regressao que a camada 1 existe para pegar.
      throw new Error(
        `Gravacao do caso "${this.#gravacao.caso}" esgotada na chamada ${this.#posicao}. ` +
          `O agente pediu mais turnos que o gravado; regrave com --ao-vivo.`,
      );
    }
    return proxima;
  }
}

/** Envolve o modelo de verdade e guarda o que ele respondeu. Camada 2. */
export class ModeloGravador implements ModeloDeLinguagem {
  readonly #interno: ModeloDeLinguagem;
  readonly #respostas: RespostaDoModelo[] = [];
  #assinatura: string | undefined;

  constructor(interno: ModeloDeLinguagem) {
    this.#interno = interno;
  }

  async responder(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    this.#assinatura ??= assinatura(pedido.sistema, pedido.ferramentas);
    const resposta = await this.#interno.responder(pedido);
    this.#respostas.push(resposta);
    return resposta;
  }

  gravacao(caso: string, modelo: string, gravadoEm: string): Gravacao {
    if (!this.#assinatura) {
      throw new Error(`O caso "${caso}" nao chegou a chamar o modelo; nao ha o que gravar.`);
    }
    return {
      caso,
      assinatura: this.#assinatura,
      gravadoEm,
      modelo,
      respostas: this.#respostas,
    };
  }
}

export function caminhoDaGravacao(caso: string, pasta = PASTA_DE_GRAVACOES): string {
  return join(pasta, `${caso}.json`);
}

export async function carregarGravacao(caso: string, pasta = PASTA_DE_GRAVACOES): Promise<Gravacao> {
  let bruto: string;
  try {
    bruto = await readFile(caminhoDaGravacao(caso, pasta), "utf8");
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === "ENOENT") throw new GravacaoAusente(caso);
    throw erro;
  }
  return JSON.parse(bruto) as Gravacao;
}

export async function salvarGravacao(gravacao: Gravacao, pasta = PASTA_DE_GRAVACOES): Promise<void> {
  const caminho = caminhoDaGravacao(gravacao.caso, pasta);
  await mkdir(dirname(caminho), { recursive: true });
  // Indentado e versionado de proposito: a gravacao entra no repositorio, e o
  // diff dela e o que mostra o que mudou no comportamento do modelo entre duas
  // regravacoes.
  await writeFile(caminho, JSON.stringify(gravacao, null, 2) + "\n", "utf8");
}
