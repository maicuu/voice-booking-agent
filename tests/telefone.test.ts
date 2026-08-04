import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { formatarTelefone, normalizarTelefone, telefoneParaFala } from "../src/agenda/telefone.ts";

describe("normalizacao de telefone", () => {
  it("aceita os formatos que um cliente fala ou digita, e produz a mesma chave", () => {
    const esperado = "5511999998888";
    for (const entrada of [
      "11999998888",
      "(11) 99999-8888",
      "11 99999 8888",
      "+55 11 99999-8888",
      "5511999998888",
    ]) {
      strictEqual(normalizarTelefone(entrada), esperado, `falhou para "${entrada}"`);
    }
  });

  it("recusa o que a API tambem recusaria, antes de virar pergunta de confirmacao", () => {
    // Fixo de 10 digitos: a barbearia usa o numero no WhatsApp.
    strictEqual(normalizarTelefone("1133334444"), null);
    // Sem o 9 do celular.
    strictEqual(normalizarTelefone("11833334444"), null);
    // DDD que nao existe.
    strictEqual(normalizarTelefone("01999998888"), null);
    // Digito repetido: o que um STT devolve quando ouve mal.
    strictEqual(normalizarTelefone("99999999999"), null);
    // Curto e vazio.
    strictEqual(normalizarTelefone("999998888"), null);
    strictEqual(normalizarTelefone(""), null);
  });
});

describe("telefone para o cliente ouvir e ler", () => {
  it("formata para texto", () => {
    strictEqual(formatarTelefone("5511999998888"), "(11) 99999-8888");
  });

  it("soletra para a confirmacao por voz", () => {
    // Um TTS lendo "5511999998888" produz um cardinal que ninguem confere.
    strictEqual(telefoneParaFala("5511999998888"), "1 1, 9 9 9 9 9, 8 8 8 8");
  });
});
