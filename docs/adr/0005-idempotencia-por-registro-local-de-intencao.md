# ADR 0005: Idempotência por registro local de intenção, e nunca afirmar sucesso incerto

**Data:** 2026-08-04
**Status:** Aceito

## Contexto

Criar um agendamento é a única ação do agente com efeito colateral irreversível na
agenda de outra pessoa. Agendar duas vezes é o bug clássico (`plano.md` §6.3).

O que a API do AgendaFácil oferece para resolver isso, pela ADR 0003:

- `POST /schedule` responde `{ success: true }`, **sem identificador do evento**.
- **Não existe leitura pública de agendamentos.** A rota de listagem exige token de
  administrador do estabelecimento.
- Não há campo de chave de idempotência na requisição.

O que a API já protege sozinha: a escrita revalida o slot contra o Google Agenda no
momento do `POST`. Se o horário já estiver ocupado — inclusive por um evento que o
próprio agente acabou de criar — a resposta é `409`. Ou seja, **um reenvio que
duplicaria bate em `409` no servidor**. A trava existe; o que não existe é como
saber de quem é o evento que causou o `409`.

Isso deixa exatamente três desfechos possíveis para um `POST`:

| desfecho | o que se sabe |
|---|---|
| `200` | escreveu |
| `4xx` de validação | não escreveu |
| timeout, conexão caída, `5xx` | **não se sabe** |

A terceira linha é o problema inteiro. Um reenvio cego duplica; não reenviar pode
perder o agendamento; e afirmar qualquer uma das duas coisas ao cliente é mentir.

## Decisão

**Chave de idempotência**, derivada só do que define "o mesmo agendamento" do ponto
de vista do cliente:

```
sha256(telefone_e164 | serviceId | date | slot)
```

O profissional fica **fora da chave de propósito**: se ele entrasse, duas tentativas
para o mesmo cliente no mesmo horário com profissionais diferentes teriam chaves
distintas e as duas escreveriam — que é precisamente a duplicata que a chave existe
para impedir. O telefone é normalizado para E.164 antes de entrar no cálculo, com a
mesma regra da API, para que "(11) 99999-9999" e "5511999999999" produzam a mesma
chave.

**Registro local de intenção, escrito antes da chamada.** Antes de qualquer `POST`, o
agente grava a chave em armazenamento durável com estado `pendente`. Depois da
resposta, atualiza para `confirmado`, `recusado` ou `incerto`. O registro é a
memória do agente sobre o que ele tentou fazer — a API não a oferece.

**Comportamento por estado, ao reencontrar a mesma chave:**

| estado registrado | o que o agente faz |
|---|---|
| `confirmado` | não reescreve; responde a partir do registro |
| `recusado` | pode tentar de novo — está estabelecido que não escreveu |
| `pendente` / `incerto` | **não reescreve** |

**Um único reenvio automático**, e só no desfecho incerto, dentro do mesmo turno:

- `200` no reenvio → `confirmado`. A primeira tentativa não tinha escrito.
- `409` no reenvio → permanece `incerto`. O slot está ocupado, mas não há como saber
  se por este agendamento ou por terceiro.
- qualquer outro erro → permanece `incerto`.

**No estado `incerto`, o agente nunca afirma que agendou.** Ele degrada com a verdade
(`plano.md` §6.5): diz que não conseguiu confirmar, informa que o horário consta
ocupado, e encaminha para o contato da barbearia. É a mesma regra da ADR 0001 —
não afirmar o que não veio de uma resposta da API — aplicada à escrita.

## Alternativas descartadas

- **Tratar `409` no reenvio como confirmação** — descartada, e é a decisão que mais
  importa aqui. É tentador: na maioria das vezes o evento que causa o `409` é mesmo o
  da primeira tentativa, e o agente encerraria a conversa com uma frase satisfatória.
  Mas os dois casos são indistinguíveis pela API, e no caso errado — a escrita
  falhou **e** um terceiro pegou o slot — o cliente ouve "confirmado", não tem
  agendamento, e descobre no balcão. Um falso positivo silencioso é pior que uma
  frase constrangedora, e transformaria o agente exatamente naquilo que a ADR 0001
  proíbe: uma afirmação de negócio que nenhuma resposta da API sustenta.
- **Reenviar até dar `200`** — descartada porque cria a duplicata que a chave existe
  para evitar, e porque o `409` do servidor tornaria o laço infinito no caso em que
  a primeira escrita funcionou.
- **Nunca reenviar, marcar incerto de imediato** — descartada porque desiste cedo
  demais: falha de rede transitória é o caso comum, e o reenvio resolve a maioria
  delas com `200`. Desistir no primeiro erro entregaria conversas degradadas sem
  necessidade.
- **Guardar o registro só em memória, por conversa** — descartada porque o cenário
  que importa inclui o processo morrer entre o `POST` e a resposta. Registro que não
  sobrevive ao processo não cobre o caso para o qual foi criado.
- **Buscar o evento no Google Agenda para desambiguar o `409`** — descartada porque
  exigiria dar ao agente credencial de calendário do profissional. O agente passaria
  a ter acesso de escrita à agenda por um caminho que não é a API, o que anula a
  fronteira da ADR 0003 e cria um segredo de alto valor onde não havia nenhum.
- **Pedir a rota de agente no AgendaFácil**, que devolveria o id do evento e aceitaria
  a chave de idempotência, resolvendo o `409` ambíguo de forma definitiva —
  descartada por ora pelo mesmo motivo da ADR 0003: mexer em produção antes de
  existir o agente. É a saída correta no dia em que esta decisão se mostrar frágil.

## Consequências

- **Existe um estado terminal em que o agente não sabe o que aconteceu**, e ele é
  visível para o cliente. Isso é assumido: a alternativa é mentir. A frequência desse
  estado vira métrica da suíte de avaliação, não um detalhe escondido.
- **O agente passa a ter estado durável**, e portanto um arquivo a gerenciar: o
  registro de intenções. Ele antecede o armazenamento de traces da Fase 3 e
  provavelmente será absorvido por ele.
- **A chave ignora o profissional**, então o cliente não consegue agendar dois
  serviços diferentes no mesmo horário — o que é o comportamento correto — mas
  também não consegue, pela mesma chave, marcar o mesmo serviço no mesmo horário
  para outra pessoa a partir do mesmo telefone. É uma limitação real: uma mãe
  agendando para dois filhos no mesmo horário. Aceita na Fase 1; se aparecer na
  suíte de avaliação, o nome do cliente entra na chave.
- **A suíte de avaliação ganha um caso obrigatório**: falha de rede injetada entre o
  `POST` e a resposta, verificando que existe exatamente um evento no fim e que o
  agente não afirmou sucesso quando não podia.
- O registro local não substitui a trava do servidor. As duas atuam em camadas
  diferentes, e a do servidor é a que vale — a local existe para o agente saber o
  que dizer.

## Como saberei que errei

Se a suíte de avaliação, ou um trace real, mostrar dois eventos criados para a mesma
chave, o registro local não está cumprindo o papel e a chave precisa ir para o
servidor.

E se o estado `incerto` aparecer com frequência relevante nas conversas — a ponto de a
taxa de conclusão de tarefa (`plano.md` §9) cair de forma perceptível — então a
ambiguidade do `409` deixou de ser um caso de borda e a rota de agente no
AgendaFácil, descartada acima, passa a ser obrigatória.
