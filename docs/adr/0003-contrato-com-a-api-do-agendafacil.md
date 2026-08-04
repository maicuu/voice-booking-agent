# ADR 0003: Contrato com a API do AgendaFácil, consumida como cliente externo

**Data:** 2026-08-04
**Status:** Aceito

## Contexto

A ADR 0001 fixa que toda afirmação sobre disponibilidade, preço, serviço ou
profissional vem de uma chamada à API. Falta definir **qual** superfície da API do
AgendaFácil o agente consome, e em que ambiente.

O mapeamento das rotas públicas, feito lendo o código do AgendaFácil (base `/api`):

| rota | entrada | saída |
|---|---|---|
| `GET /config/:slug` | slug do estabelecimento | `nome`, `plano`, `logoUrl`, `cores`, `barbers[]`, `services[]`, `horariosPorDia[]` |
| `GET /:slug/barbersAndServices` | slug | subconjunto do anterior |
| `GET /slots` | `barberId`, `serviceId`, `date` (YYYY-MM-DD) | `["09:00","10:00"]`, ou `[]` |
| `POST /schedule` | `barberId`, `serviceId`, `clientName`, `clientPhone`, `date`, `slot`, `cfToken` | `{ success: true }` |

Fatos que restringem a escolha:

- **A validação de horário é do servidor, e é a mesma na leitura e na escrita.** Uma
  função única decide se um slot é agendável: janela da loja por dia da semana,
  expediente individual do profissional, pausa, bloqueios, **antecedência mínima de
  2 horas** e conflito com o Google Agenda. O `POST /schedule` reexecuta essa
  validação contra o Google no momento da escrita, então um slot lido e depois
  ocupado por terceiro devolve `409`.
- **`POST /schedule` exige `cfToken`**, um token do Cloudflare Turnstile validado no
  servidor. É um desafio de navegador: um processo server-side não o produz.
- **`POST /schedule` responde `{ success: true }`** — sem identificador do evento
  criado.
- **Não existe leitura pública de agendamentos.** A rota que lista agendamentos exige
  token de administrador do estabelecimento.
- **`/slots` é por profissional, por serviço e por dia.** Não há consulta agregada.
- **`[]` é ambíguo**: dia fechado e dia lotado devolvem a mesma resposta.
- Timezone fixo em `America/Sao_Paulo`, com o deslocamento `-03:00` escrito no
  código do AgendaFácil.
- `POST /schedule` tem limite de 30 por hora por cliente.

## Decisão

O Recepcionista consome as quatro rotas públicas acima como **cliente externo**, sem
importar código, modelo ou banco do AgendaFácil, e sem depender de detalhe interno
dele. O acoplamento é o corpo JSON das rotas e nada mais.

O desenvolvimento roda contra uma **instância local** do AgendaFácil, com a secret de
teste do Turnstile — pública e documentada pela Cloudflare, aprova qualquer token —
já prevista no `.env.example` daquele repositório. O agente envia um `cfToken` de
marcador. **Nenhuma alteração é feita no AgendaFácil**, e a API em produção não é
usada como alvo de escrita durante o desenvolvimento.

As quatro consequências que caem no Recepcionista, e não na API:

1. **Resolução de nome para id.** O modelo recebe nomes ("corte com barba", "o
   Ricardo") e a API exige `ObjectId`. A tradução é do agente, a partir de
   `GET /config/:slug`, com cache por conversa.
2. **Leque de consultas.** "Quinta de tarde com qualquer um" vira uma chamada de
   `/slots` por profissional; "semana que vem" multiplica por dia. As chamadas de um
   mesmo turno são disparadas em paralelo, e o custo entra no orçamento de latência
   (`plano.md` §6.1).
3. **Desambiguação do `[]`.** O agente cruza a resposta vazia com `horariosPorDia`
   para distinguir "não abre nesse dia" de "está cheio" — são frases diferentes para
   o cliente.
4. **Antecedência de 2 horas é regra do servidor**, não do agente. O agente não a
   reimplementa; ele lê `/slots`, que já a aplica.

## Alternativas descartadas

- **Alterar o AgendaFácil para expor uma rota de agente** (`POST /api/agent/schedule`
  autenticada por chave, devolvendo o id do evento e aceitando chave de idempotência)
  — descartada **por ora**, não por ser ruim: é a solução tecnicamente correta e
  resolve junto o problema de idempotência da ADR 0005. Descartada agora porque
  significa mexer num sistema em produção antes de existir uma linha de código do
  agente, e porque a Fase 1 fecha sem isso. Fica registrada como o próximo passo
  natural se a ADR 0005 se mostrar frágil na suíte de avaliação.
- **Ler o MongoDB do AgendaFácil diretamente** — descartada porque destrói a
  premissa do projeto. A validação de horário, a antecedência e a checagem contra o
  Google vivem no código da API; ler o banco significaria reimplementar tudo isso do
  lado do agente, com duas cópias divergindo. Além disso transformaria dois sistemas
  independentes em um só, acoplado por schema.
- **Importar o código do AgendaFácil como pacote** — descartada pelo mesmo motivo, e
  porque o `AGENTS.md` define a relação como consumidor de API pública. Um agente que
  só funciona colado no backend não prova integração com API.
- **Apontar a escrita para a API em produção durante o desenvolvimento** — descartada
  porque cada execução da suíte de avaliação criaria eventos reais na agenda de
  alguém. Um caso de teste com efeito colateral irreversível em produção é
  exatamente o erro que este projeto existe para mostrar que se sabe evitar.
- **Fingir a API inteira com um servidor de mentira desde o começo** — descartada
  porque elimina o argumento do projeto: o valor está em agendar contra um sistema
  real. O duplo em memória existe (ADR 0004), mas serve à suíte de avaliação em CI,
  não ao desenvolvimento do caminho feliz.

## Consequências

- **O agente não consegue confirmar o que escreveu.** Sem id do evento e sem leitura
  pública, a única evidência de sucesso é o `{ success: true }` da resposta. Isso é o
  problema inteiro da ADR 0005 e é herdado desta decisão.
- **A latência da conversa passa a depender do Google Agenda.** Cada `/slots` faz uma
  chamada externa dentro da API, e o leque do item 2 multiplica isso. Se o orçamento
  de latência estourar, o primeiro lugar a olhar é aqui.
- **Rodar o agente localmente exige subir o AgendaFácil**, com MongoDB e uma conta
  Google conectada a pelo menos um profissional. Sem `googleRefreshToken`, `/slots`
  devolve `503` e `/schedule` devolve `400` — nenhum dos dois é caminho feliz.
- **A suíte de avaliação não pode depender disso** (Mongo + OAuth + rede em CI).
  Daí o duplo em memória com o mesmo contrato, na ADR 0004.
- **O agente fica limitado ao que as quatro rotas respondem.** Pergunta sem rota
  correspondente — "vocês vendem pomada?", "aceita cartão?" — é recusa explícita, não
  improviso do modelo. Isso já era consequência da ADR 0001; aqui ganha fronteira
  exata.
- **Mudança no AgendaFácil pode quebrar o agente sem aviso**, porque não há contrato
  versionado entre os dois. Mitigado por um teste de contrato que roda contra a
  instância local e falha quando o formato muda.

## Como saberei que errei

Se o leque de chamadas do item 2 colocar a etapa de ferramentas acima de ~400 ms no
p95 do orçamento de latência, o modelo de consulta por profissional e por dia não se
sustenta e a API precisa de uma rota agregada.

E se a ADR 0005 não conseguir fechar o caso de reentrega com a informação que estas
rotas devolvem — se a suíte de avaliação mostrar agendamento duplicado ou perdido em
falha de rede — então a alternativa descartada no primeiro item deixa de ser opcional.
