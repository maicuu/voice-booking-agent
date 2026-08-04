import { createHash } from "node:crypto";
import type { AgendaClient, CodigoErro, PedidoAgendamento } from "./tipos.ts";

/**
 * A politica da ADR 0005, e o unico lugar do projeto autorizado a chamar
 * `AgendaClient.agendar`.
 *
 * O problema: `POST /schedule` responde `{ success: true }` sem identificador, e
 * nao ha leitura publica de agendamentos. Um timeout deixa o agente sem saber se
 * escreveu. Reenviar as cegas duplica; nao reenviar perde o agendamento; e
 * afirmar qualquer uma das duas coisas ao cliente e mentir.
 *
 * A saida tem tres partes: uma chave deterministica, um registro duravel
 * escrito antes da chamada, e a recusa a chamar de "confirmado" aquilo que a API
 * nao confirmou.
 */

export type EstadoIntencao = "pendente" | "confirmado" | "recusado" | "incerto";

export type Intencao = {
  chave: string;
  estado: EstadoIntencao;
  /** Para diagnostico no trace. Nao participa da decisao. */
  detalhe?: string;
};

/**
 * Precisa sobreviver ao processo morrer entre a chamada e a resposta — que e
 * exatamente o cenario para o qual foi criado. Guardar so em memoria nao cobre
 * o caso (ADR 0005).
 */
export interface RegistroDeIntencao {
  ler(chave: string): Promise<Intencao | undefined>;
  gravar(intencao: Intencao): Promise<void>;
}

export type ResultadoIdempotente =
  | { estado: "confirmado"; chave: string; reaproveitado: boolean }
  | { estado: "recusado"; chave: string; codigo: CodigoErro; motivo: string }
  | { estado: "incerto"; chave: string; causa: string };

/**
 * `sha256(telefone | servico | data | hora)`.
 *
 * O profissional fica de fora de proposito. Se entrasse, duas tentativas para o
 * mesmo cliente no mesmo horario com profissionais diferentes teriam chaves
 * distintas e as duas escreveriam — que e precisamente a duplicata que a chave
 * existe para impedir.
 *
 * O telefone entra ja normalizado em E.164 (`telefone.ts`), senao "(11)
 * 99999-9999" e "5511999999999" produziriam chaves diferentes e a chave nao
 * serviria para nada.
 */
export function chaveDeIdempotencia(pedido: PedidoAgendamento): string {
  return createHash("sha256")
    .update([pedido.telefoneCliente, pedido.servicoId, pedido.data, pedido.hora].join("|"))
    .digest("hex");
}

export async function agendarComIdempotencia(
  cliente: AgendaClient,
  registro: RegistroDeIntencao,
  pedido: PedidoAgendamento,
): Promise<ResultadoIdempotente> {
  const chave = chaveDeIdempotencia(pedido);
  const anterior = await registro.ler(chave);

  if (anterior?.estado === "confirmado") {
    // Ja existe. Reescrever criaria o segundo evento que a chave existe para
    // impedir — e a API, revalidando contra a agenda, recusaria com 409 de
    // qualquer forma.
    return { estado: "confirmado", chave, reaproveitado: true };
  }

  if (anterior?.estado === "pendente" || anterior?.estado === "incerto") {
    // Uma tentativa anterior nao resolveu. Reenviar aqui e o caminho direto para
    // a duplicata, porque nao se sabe se aquela escreveu.
    return {
      estado: "incerto",
      chave,
      causa: anterior.detalhe ?? "tentativa anterior nao resolvida",
    };
  }

  // Antes da chamada, nao depois: o registro precisa existir mesmo que o
  // processo morra durante a requisicao.
  await registro.gravar({ chave, estado: "pendente" });

  const primeira = await cliente.agendar(pedido);

  if (primeira.estado === "confirmado") {
    await registro.gravar({ chave, estado: "confirmado" });
    return { estado: "confirmado", chave, reaproveitado: false };
  }

  if (primeira.estado === "recusado") {
    await registro.gravar({ chave, estado: "recusado", detalhe: primeira.motivo });
    return { estado: "recusado", chave, codigo: primeira.codigo, motivo: primeira.motivo };
  }

  // Desfecho incerto: um unico reenvio, e so aqui. Falha de rede transitoria e o
  // caso comum, e o reenvio resolve a maioria delas.
  const segunda = await cliente.agendar(pedido);

  if (segunda.estado === "confirmado") {
    // A primeira tentativa nao tinha escrito: se tivesse, a revalidacao do
    // servidor contra a agenda teria recusado este reenvio.
    await registro.gravar({ chave, estado: "confirmado" });
    return { estado: "confirmado", chave, reaproveitado: false };
  }

  if (segunda.estado === "recusado" && segunda.codigo === "slot_ocupado") {
    // O horario esta ocupado, e nao ha como saber por quem: pelo agendamento
    // da primeira tentativa, ou por outra pessoa que pegou o slot no intervalo.
    //
    // Chamar isso de confirmado seria a decisao confortavel e e a que a ADR 0005
    // recusa: no caso errado o cliente ouve "confirmado", nao tem agendamento, e
    // descobre no balcao. O agente diz a verdade — nao consegui confirmar — e
    // encaminha.
    const causa = "o horario consta ocupado e nao foi possivel confirmar de quem e o agendamento";
    await registro.gravar({ chave, estado: "incerto", detalhe: causa });
    return { estado: "incerto", chave, causa };
  }

  const causa = segunda.estado === "incerto" ? segunda.causa : segunda.motivo;
  await registro.gravar({ chave, estado: "incerto", detalhe: causa });
  return { estado: "incerto", chave, causa };
}
