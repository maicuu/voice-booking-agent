import type { Telefone } from "./tipos.ts";

/**
 * Normaliza para E.164 sem o `+`: `55` + DDD + 9 digitos.
 *
 * A regra e a mesma que a API do AgendaFacil aplica na escrita, e precisa ser,
 * por dois motivos: um telefone que a API vai rejeitar deve ser recusado antes
 * de virar uma pergunta de confirmacao ao cliente, e a chave de idempotencia
 * (ADR 0005) e derivada deste valor — se "(11) 99999-9999" e "5511999999999"
 * produzissem chaves diferentes, a chave nao serviria para nada.
 *
 * Devolve `null` quando o numero nao serve, em vez de lancar: numero mal
 * entendido e o caso comum de um agente de voz, nao uma excecao.
 */
export function normalizarTelefone(bruto: string): Telefone | null {
  let d = String(bruto ?? "").replace(/\D/g, "");

  // Codigo do pais: remove para validar o miolo, e devolve depois.
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);

  // Exatamente 11: DDD (2) + o 9 + numero (8). Fixo de 10 digitos nao entra —
  // o campo e o WhatsApp do cliente, e a barbearia usa esse numero para
  // confirmar.
  if (d.length !== 11) return null;

  const ddd = Number(d.slice(0, 2));
  if (!(ddd >= 11 && ddd <= 99)) return null;

  // Desde 2016 todo celular tem o 9 depois do DDD.
  if (d[2] !== "9") return null;

  // Sequencia de um digito so ("99999999999") e o que um STT devolve quando
  // ouve mal, nao um telefone.
  if (/^(\d)\1+$/.test(d)) return null;

  return "55" + d;
}

/** `5511999998888` para `(11) 99999-8888`. Para texto na tela e em log. */
export function formatarTelefone(telefone: Telefone): string {
  const d = telefone.replace(/\D/g, "").replace(/^55/, "");
  if (d.length !== 11) return telefone;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * `5511999998888` para "onze, nove nove nove nove nove, oito oito oito oito".
 *
 * A confirmacao por voz precisa ler o numero de volta, e um TTS lendo
 * "5511999998888" produz um numero cardinal gigante que ninguem consegue
 * conferir. Existe aqui, e nao no prompt, porque conferencia de digito nao pode
 * depender de o modelo lembrar de soletrar.
 */
export function telefoneParaFala(telefone: Telefone): string {
  const d = telefone.replace(/\D/g, "").replace(/^55/, "");
  if (d.length !== 11) return telefone;
  const digitos = (s: string) => s.split("").join(" ");
  return `${digitos(d.slice(0, 2))}, ${digitos(d.slice(2, 7))}, ${digitos(d.slice(7))}`;
}
