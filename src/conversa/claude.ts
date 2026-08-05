import Anthropic from "@anthropic-ai/sdk";
import {
  ErroModelo,
  type ChamadaDeFerramenta,
  type Entrada,
  type ModeloDeLinguagem,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from "./tipos.ts";

/**
 * Implementacao de `ModeloDeLinguagem` sobre a API da Anthropic (ADR 0006).
 *
 * Unico arquivo do projeto que conhece o formato de mensagem do provedor. Acima
 * daqui existe `Entrada[]`, e mais nada.
 */

/** Haiku 4.5: o mais barato com tool calling nativo (ADR 0006). */
export const MODELO_PADRAO = "claude-haiku-4-5";

export type ConfigClaude = {
  apiKey?: string;
  modelo?: string;
  /**
   * Teto por resposta. Um turno de agente de voz tem uma ou duas frases; 1024
   * e folgado para isso e limita o estrago de um turno que sai do controle.
   * Nao afeta o custo do caso normal — a cobranca e por token gerado, nao pelo
   * teto.
   */
  maxTokens?: number;
};

export class ModeloClaude implements ModeloDeLinguagem {
  readonly #cliente: Anthropic;
  readonly #modelo: string;
  readonly #maxTokens: number;

  constructor(config: ConfigClaude = {}) {
    // Sem apiKey explicita o SDK resolve do ambiente (ANTHROPIC_API_KEY, token
    // de ambiente ou perfil do `ant auth login`).
    this.#cliente = config.apiKey ? new Anthropic({ apiKey: config.apiKey }) : new Anthropic();
    this.#modelo = config.modelo ?? MODELO_PADRAO;
    this.#maxTokens = config.maxTokens ?? 1024;
  }

  async responder(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
    let resposta: Anthropic.Message;
    try {
      resposta = await this.#cliente.messages.create({
        model: this.#modelo,
        max_tokens: this.#maxTokens,
        system: pedido.sistema,
        tools: pedido.ferramentas.map((f) => ({
          name: f.nome,
          description: f.descricao,
          input_schema: f.esquema as Anthropic.Tool.InputSchema,
        })),
        messages: converterTranscricao(pedido.transcricao),
      });
    } catch (erro) {
      throw traduzirErro(erro);
    }

    // Uma recusa do modelo chega como resposta bem-sucedida com `content`
    // vazio. Ler `content[0]` sem checar aqui daria um turno silencioso — o
    // agente ficaria mudo no telefone, que e o pior desfecho possivel.
    if (resposta.stop_reason === "refusal") {
      throw new ErroModelo("recusado", "O modelo recusou a requisicao.");
    }

    const texto: string[] = [];
    const chamadas: ChamadaDeFerramenta[] = [];
    for (const bloco of resposta.content) {
      if (bloco.type === "text") {
        texto.push(bloco.text);
      } else if (bloco.type === "tool_use") {
        chamadas.push({
          id: bloco.id,
          nome: bloco.name,
          argumentos: (bloco.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      texto: texto.join("").trim(),
      chamadas,
      uso: {
        entrada: resposta.usage.input_tokens,
        saida: resposta.usage.output_tokens,
      },
    };
  }
}

export function converterTranscricao(transcricao: readonly Entrada[]): Anthropic.MessageParam[] {
  const mensagens: Anthropic.MessageParam[] = [];

  for (const entrada of transcricao) {
    switch (entrada.tipo) {
      case "cliente":
        mensagens.push({ role: "user", content: entrada.texto });
        break;

      case "agente": {
        const blocos: Anthropic.ContentBlockParam[] = [];
        // Bloco de texto vazio e recusado pela API. O turno em que o modelo so
        // chama ferramenta, sem falar nada, e o caso comum — nao a excecao.
        if (entrada.texto.length > 0) {
          blocos.push({ type: "text", text: entrada.texto });
        }
        for (const chamada of entrada.chamadas) {
          blocos.push({
            type: "tool_use",
            id: chamada.id,
            name: chamada.nome,
            input: chamada.argumentos,
          });
        }
        if (blocos.length > 0) mensagens.push({ role: "assistant", content: blocos });
        break;
      }

      case "ferramentas":
        // Todos os resultados de uma rodada vao numa mensagem so. Espalhar em
        // varias ensina o modelo a parar de pedir ferramentas em paralelo.
        mensagens.push({
          role: "user",
          content: entrada.resultados.map(
            (r): Anthropic.ToolResultBlockParam => ({
              type: "tool_result",
              tool_use_id: r.id,
              content: r.conteudo,
              ...(r.erro ? { is_error: true } : {}),
            }),
          ),
        });
        break;
    }
  }

  return mensagens;
}

function traduzirErro(erro: unknown): ErroModelo {
  if (erro instanceof Anthropic.AuthenticationError || erro instanceof Anthropic.PermissionDeniedError) {
    return new ErroModelo("credencial", "Chave de API ausente ou sem permissao.");
  }
  if (erro instanceof Anthropic.RateLimitError) {
    return new ErroModelo("limite_excedido", "Limite de requisicoes do provedor atingido.");
  }
  if (erro instanceof Anthropic.BadRequestError) {
    // 400 e bug do agente — esquema de ferramenta invalido, transcricao mal
    // montada. Nao adianta tentar de novo com a mesma requisicao.
    return new ErroModelo("requisicao_invalida", `Requisicao rejeitada: ${erro.message}`);
  }
  if (erro instanceof Anthropic.APIConnectionError) {
    return new ErroModelo("indisponivel", "Nao foi possivel falar com o provedor do modelo.");
  }
  if (erro instanceof Anthropic.APIError) {
    return new ErroModelo("indisponivel", `Erro do provedor: ${erro.message}`);
  }
  return new ErroModelo("indisponivel", erro instanceof Error ? erro.message : String(erro));
}
