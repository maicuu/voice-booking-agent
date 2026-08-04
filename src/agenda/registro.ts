import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Intencao, RegistroDeIntencao } from "./idempotencia.ts";

/**
 * Implementacoes de `RegistroDeIntencao` (ADR 0005).
 *
 * O registro em arquivo e provisorio por design: ele existe porque a Fase 1
 * precisa de durabilidade e nao precisa de banco. Na Fase 3, quando os traces
 * ganharem armazenamento proprio, ele provavelmente e absorvido por ele — a
 * interface e o que sobrevive.
 */

/** Para teste e para a suite de avaliacao, onde cada caso comeca do zero. */
export class RegistroEmMemoria implements RegistroDeIntencao {
  readonly #intencoes = new Map<string, Intencao>();

  async ler(chave: string): Promise<Intencao | undefined> {
    return this.#intencoes.get(chave);
  }

  async gravar(intencao: Intencao): Promise<void> {
    this.#intencoes.set(intencao.chave, intencao);
  }

  get tamanho(): number {
    return this.#intencoes.size;
  }
}

/**
 * Arquivo append-only, uma intencao por linha em JSON.
 *
 * Append em vez de reescrever o arquivo inteiro por dois motivos. O primeiro e
 * durabilidade: reescrever tem uma janela em que o arquivo esta truncado, e uma
 * queda ali apaga o registro inteiro — justamente no cenario de queda que este
 * registro existe para cobrir. O segundo e que o historico de transicoes
 * (`pendente` e depois `incerto`) e material de trace: ele conta o que o agente
 * tentou, nao so onde parou.
 *
 * A ultima linha de uma chave vence. O arquivo e lido uma vez, na primeira
 * consulta, e mantido em memoria depois — ele so cresce com escritas do proprio
 * processo.
 */
export class RegistroEmArquivo implements RegistroDeIntencao {
  readonly #caminho: string;
  #estado: Map<string, Intencao> | undefined;
  #carregando: Promise<Map<string, Intencao>> | undefined;

  constructor(caminho: string) {
    this.#caminho = caminho;
  }

  async ler(chave: string): Promise<Intencao | undefined> {
    const estado = await this.#carregar();
    return estado.get(chave);
  }

  async gravar(intencao: Intencao): Promise<void> {
    const estado = await this.#carregar();
    await mkdir(dirname(this.#caminho), { recursive: true });
    // O `await` do append vem antes de atualizar a memoria: se a escrita em
    // disco falhar, a memoria nao pode afirmar um estado que o disco nao tem.
    await appendFile(this.#caminho, JSON.stringify(intencao) + "\n", "utf8");
    estado.set(intencao.chave, intencao);
  }

  async #carregar(): Promise<Map<string, Intencao>> {
    if (this.#estado) return this.#estado;
    // Duas chamadas concorrentes na primeira consulta nao podem ler o arquivo
    // duas vezes; a segunda espera a promessa da primeira.
    this.#carregando ??= this.#lerArquivo();
    this.#estado = await this.#carregando;
    return this.#estado;
  }

  async #lerArquivo(): Promise<Map<string, Intencao>> {
    const estado = new Map<string, Intencao>();
    let conteudo: string;
    try {
      conteudo = await readFile(this.#caminho, "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return estado;
      throw erro;
    }

    for (const linha of conteudo.split("\n")) {
      if (linha.trim().length === 0) continue;
      try {
        const intencao = JSON.parse(linha) as Intencao;
        if (typeof intencao?.chave === "string") estado.set(intencao.chave, intencao);
      } catch {
        // Linha truncada por queda no meio de uma escrita. Descartar uma linha
        // ilegivel e melhor que recusar a subir: o pior caso e uma chave voltar
        // ao estado anterior, e o estado anterior de uma escrita interrompida e
        // `pendente`, que ja e tratado como incerto.
        continue;
      }
    }
    return estado;
  }
}
