import { ok, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { AgendaHttp, desambiguarVazio } from "../src/agenda/http.ts";
import { ErroAgenda } from "../src/agenda/tipos.ts";
import { ehHora, hoje, somarDias } from "../src/agenda/datas.ts";

/**
 * Teste de contrato (ADR 0003).
 *
 * Os outros testes usam `fetch` injetado e provam o que o cliente faz com cada
 * resposta. Este prova a outra metade — que a API responde aquilo — e e o unico
 * que falha quando o AgendaFacil muda de formato sem avisar. Nao ha contrato
 * versionado entre os dois repositorios; este arquivo faz o papel dele.
 *
 * Fica desligado por padrao. Para rodar, suba o AgendaFacil local e exporte:
 *
 *   AGENDA_API_BASE_URL=http://localhost:3000/api
 *   AGENDA_TENANT=minha-barbearia
 *
 * So leitura: nenhum caso aqui escreve na agenda de ninguem. O caminho de
 * escrita tem efeito colateral irreversivel numa agenda real e nao pode rodar
 * junto da suite (`plano.md` §6.3).
 */

const baseUrl = process.env["AGENDA_API_BASE_URL"];
const slug = process.env["AGENDA_TENANT"];
const ligado = Boolean(baseUrl && slug);

describe("contrato com a API do AgendaFacil", { skip: ligado ? false : "AGENDA_API_BASE_URL nao definida" }, () => {
  const cliente = new AgendaHttp({
    baseUrl: baseUrl ?? "",
    tokenDesafio: process.env["AGENDA_TOKEN_DESAFIO"] ?? "marcador",
    timeoutMs: 20_000,
    // Cada caso deve bater na API de verdade; cache aqui esconderia mudanca.
    cacheConfigMs: 0,
  });

  it("a configuracao traz os campos de que o agente depende", async () => {
    const est = await cliente.estabelecimento(slug!);

    ok(est.nome.length > 0, "estabelecimento sem nome");
    ok(est.profissionais.length > 0, "nenhum profissional");
    ok(est.servicos.length > 0, "nenhum servico");
    strictEqual(est.semana.length, 7, "a semana precisa ter os sete dias");

    for (const p of est.profissionais) {
      ok(p.id.length > 0, "profissional sem id");
      ok(p.nome.length > 0, `profissional ${p.id} sem nome`);
      strictEqual(typeof p.agendaConectada, "boolean");
    }

    for (const s of est.servicos) {
      ok(s.id.length > 0, "servico sem id");
      ok(s.nome.length > 0, `servico ${s.id} sem nome`);
      ok(Number.isFinite(s.preco), `servico ${s.nome} com preco nao numerico`);
      ok(s.duracaoMin > 0, `servico ${s.nome} com duracao invalida`);
    }
  });

  it("a resposta publica nunca traz a credencial do Google", async () => {
    // A rota troca `googleRefreshToken` por um booleano. Se um dia parar de
    // trocar, o token de longa duracao de um profissional vaza para qualquer
    // um que chame a rota publica — e o agente e um deles.
    const resposta = await fetch(`${baseUrl}/config/${slug}`);
    const texto = await resposta.text();

    strictEqual(texto.includes("googleRefreshToken"), false);
  });

  it("os horarios vem no formato que o agente sabe repetir ao cliente", async () => {
    const est = await cliente.estabelecimento(slug!);
    const profissional = est.profissionais.find((p) => p.agendaConectada);
    const servico = est.servicos[0];
    ok(profissional, "nenhum profissional com agenda conectada");
    ok(servico);

    const disponibilidade = await cliente.disponibilidade({
      profissionalId: profissional.id,
      servicoId: servico.id,
      data: somarDias(hoje(), 1),
    });

    if (disponibilidade.tipo === "horarios") {
      for (const hora of disponibilidade.horarios) {
        ok(ehHora(hora), `horario fora do formato HH:MM: "${hora}"`);
      }
    }
  });

  it("dia fechado e distinguivel de dia lotado", async () => {
    const est = await cliente.estabelecimento(slug!);
    const profissional = est.profissionais.find((p) => p.agendaConectada);
    const servico = est.servicos[0];
    ok(profissional && servico);

    const fechado = est.semana.find((d) => !d.aberto);
    if (!fechado) return; // a loja abre todo dia; nada a verificar aqui

    // Proxima ocorrencia do dia fechado, dentro da semana que vem.
    let data = hoje();
    for (let i = 0; i < 7; i++) {
      data = somarDias(hoje(), i + 1);
      if (new Date(`${data}T00:00:00Z`).getUTCDay() === fechado.diaDaSemana) break;
    }

    const bruta = await cliente.disponibilidade({
      profissionalId: profissional.id,
      servicoId: servico.id,
      data,
    });
    const resolvida = desambiguarVazio(bruta, est, data);

    // A API devolve `[]` para os dois casos; a distincao e do agente.
    strictEqual(resolvida.tipo, "fechado", `esperava fechado em ${data}`);
  });

  it("slug inexistente e `nao_encontrado`, e nao uma falha generica", async () => {
    try {
      await cliente.estabelecimento("slug-que-nao-existe-em-lugar-nenhum");
      ok(false, "deveria ter falhado");
    } catch (erro) {
      ok(erro instanceof ErroAgenda, `esperava ErroAgenda, veio ${String(erro)}`);
      strictEqual(erro.codigo, "nao_encontrado");
    }
  });

  it("profissional inexistente na consulta de horarios tambem e `nao_encontrado`", async () => {
    const est = await cliente.estabelecimento(slug!);
    const servico = est.servicos[0];
    ok(servico);

    try {
      await cliente.disponibilidade({
        // ObjectId com formato valido e que nao existe: exercita o 404 da rota,
        // nao o 500 de id malformado.
        profissionalId: "000000000000000000000000",
        servicoId: servico.id,
        data: somarDias(hoje(), 1),
      });
      ok(false, "deveria ter falhado");
    } catch (erro) {
      ok(erro instanceof ErroAgenda);
      strictEqual(erro.codigo, "nao_encontrado");
    }
  });
});
