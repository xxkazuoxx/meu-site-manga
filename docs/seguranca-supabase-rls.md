# Proteção do Supabase — RLS e revogação de privilégios públicos

**Estado (13/11/2026): preparado e testado localmente. NÃO aplicado no Supabase.** Aplicar só com autorização explícita.

## Problema (Fase D)

Nas 6 tabelas (`mangas`, `chapters`, `pages`, `comments`, `schema_migrations`, `pages_backup_cloudinary_before_public_id`) o RLS está desligado e `anon`/`authenticated` têm todos os privilégios. Quem tiver a chave pública (*anon*) do projeto pode, pela API REST do Supabase, ler comentários ocultos e inserir, alterar ou apagar mangás, capítulos, páginas e comentários. O site não publica essa chave, mas ela é pública por definição.

## Arquivos (`scripts/seguranca-supabase/`)

Resumo local do diagnóstico: `resumir-diagnostico.mjs` (sem conexão a bancos).


| Arquivo | O que faz | Escreve? |
| --- | --- | --- |
| `01-diagnostico.sql` | Dono de cada tabela, se cada papel de login ignora o RLS e o que pode fazer nas 6 tabelas, RLS, papéis (atributos), herança de `anon`/`authenticated`, usuários conectados agora (sem IPs), privilégios **efetivos** (inclui herança e `PUBLIC`) em tabelas, sequências e funções, privilégios padrão para objetos futuros, políticas e o resumo `protegido`. | Não (um `SELECT`) |
| `02-aplicar-protecao.sql` | Liga RLS nas 6 tabelas; revoga **todos** os privilégios de `anon`, `authenticated` e `PUBLIC` nelas, em todas as sequências e o `EXECUTE` em funções de `public`; deixa de conceder privilégios públicos a objetos futuros. Travas e autoverificação; uma transação; idempotente. | Só permissões/RLS |
| `03-liberar-papel-backend.sql` | Se o backend do Render usar um papel que não é dono nem tem `BYPASSRLS`: cria a política `les_backend_acesso_total` e concede `SELECT/INSERT/UPDATE/DELETE` só a esse papel. Recusa papéis públicos e o valor de exemplo. | Só permissões/políticas |
| `05-verificar-papel-render.sql` | Pelo `pg_stat_statements`, mostra qual papel executou as consultas típicas do Express (só nomes de papéis e contagens, nunca o texto). | Não (um `SELECT`) |
| `04-reverter-emergencia.sql` | Volta ao estado inseguro anterior (RLS desligado + privilégios de `anon`/`authenticated` nas tabelas e sequências). Não reabre funções. | Só permissões/RLS |

Nenhum script lê, altera ou apaga linhas, nem remove tabelas (verificado por teste).

### Por que revogar tudo, não só INSERT/UPDATE/DELETE/TRUNCATE

- Com RLS ligado e nenhuma política, `anon` já não veria nem gravaria linhas; a revogação total é defesa em profundidade.
- `TRUNCATE`, `REFERENCES`, `TRIGGER` e `MAINTAIN` não são controlados pelo RLS.
- `SELECT` público expunha comentários ocultos/na lixeira e a tabela de backup antiga.
- Sequências: `setval` por papéis públicos poderia causar colisões de ID.
- Funções: as das migrações já se restringem ao `service_role`; o `REVOKE` em massa e a mudança dos privilégios padrão evitam que funções/tabelas futuras nasçam públicas (o Supabase concede a `anon` por padrão).

## Travas do `02`

1. `service_role` precisa existir com `BYPASSRLS` (backend do Cloudflare); senão aborta.
2. Recusa execução como `anon`/`authenticated`.
3. O papel que executa precisa ser dono (ou membro do dono) de cada tabela; senão aborta.
4. Autoverificação final: se `anon`, `authenticated` ou `PUBLIC` ainda tiverem qualquer privilégio efetivo (por exemplo, herdado de outro papel) ou alguma tabela de `public` ficar sem RLS, toda a transação é desfeita.

## Quem é afetado

| Cliente | Papel | Depois do `02` |
| --- | --- | --- |
| Cloudflare Pages Functions (`/api/*`) | `service_role` via `SUPABASE_SECRET_KEY` | **Sem mudança** (ignora RLS; privilégios mantidos) — *se* a chave for a secreta (`sb_secret_…` ou JWT com `role: service_role`) |
| Express no Render (`server.js`) | usuário do `DATABASE_URL` | **Sem mudança se** o usuário for o dono das tabelas (`postgres`, inclusive `postgres.<ref>` no pooler) ou tiver `BYPASSRLS`. **Quebra** (vê 0 linhas, gravações recusadas) se for outro papel → usar o `03` |
| Painel do Supabase (Table Editor/SQL Editor) | `postgres`/admin | Sem mudança |
| Qualquer cliente com a chave *anon* (API REST, supabase-js) | `anon`/`authenticated` | **Bloqueado** (intencional). Nenhum uso no código atual nem no histórico do Git |
| Migrações futuras | dono | Aplicam normalmente; tabelas novas nascem sem privilégios públicos |

## Executar o diagnóstico (somente leitura) — passo a passo

**Revisão do `01-diagnostico.sql` (13/11/2026):** um único `SELECT`; fontes só do catálogo (`pg_class`, `pg_roles`, `pg_auth_members`, `pg_default_acl`, `pg_proc`, `pg_policies`) e de `pg_stat_activity` (apenas `usename`, `application_name`, `datname`, `backend_type` — sem IP, sem texto de consultas); funções só de leitura (`has_*_privilege`, `pg_get_userbyid`, `aclexplode`, `to_regclass`, `jsonb_*`, `now`). `INSERT/UPDATE/DELETE/TRUNCATE` aparecem apenas como nomes de privilégio entre aspas. Verificado por teste e executado em modo somente leitura no PostgreSQL 18 local.

O que ele permite identificar: dono e RLS de cada tabela (`tabelas`), tabelas esperadas ausentes, privilégios **efetivos** de `anon`/`authenticated`/`PUBLIC` (inclui herança), herança de papéis, privilégios padrão para objetos futuros, políticas, e — para cada papel de login — se **ignora o RLS** e por quê (`acesso_dos_papeis_de_login`: superusuário, `BYPASSRLS` ou dono das tabelas) e o que pode fazer nas 6 tabelas.

### A. Conferir no painel do Render (sem copiar segredos)

1. *Dashboard* → serviço do backend → **Environment**.
2. Em `DATABASE_URL`, olhe **só o nome de usuário**: o trecho entre `://` e o primeiro `:` (ex.: `postgres` ou `postgres.<ref>`). Anote só isso. **Não** copie a senha, o host completo nem a URL.
3. Anote também: se o serviço está *Live* ou *Suspended*, e se *Auto-Deploy* está ligado (ver `docs/render-diagnostico-checklist.md`).

No Cloudflare (Pages → Settings → Variables): confira só se `SUPABASE_SECRET_KEY` começa com `sb_secret_` (ou é a *service_role*), nunca `sb_publishable_`. Não copie o valor.

### B. Rodar no SQL Editor do Supabase

1. Para o diagnóstico ver a conexão do Render, acorde o backend antes: abra o site publicado (ou uma rota da API) e aguarde carregar.
2. Supabase → projeto certo (Reference ID igual ao subdomínio do `SUPABASE_URL`) → **SQL Editor** → **New query**.
3. Cole `scripts/seguranca-supabase/01-diagnostico.sql` inteiro, sem alterar. Confira que é um único `SELECT` e que não há `ALTER`, `GRANT`, `REVOKE`, `DROP`, `INSERT`, `UPDATE`, `DELETE`.
4. Com nada selecionado, **Run**. Se aparecer aviso de “operação destrutiva”, **pare**.
5. Resultado: uma linha, coluna `diagnostico`. **Não** execute `02`, `03` ou `04`.

### C. Salvar e revisar localmente

```sh
cd ~/meu-site-manga
mkdir -p backups/seguranca
nano backups/seguranca/diagnostico-antes.json   # cole a célula (ou a cópia JSON da grade) e salve
chmod 600 backups/seguranca/diagnostico-antes.json
git check-ignore -v backups/seguranca/diagnostico-antes.json   # deve citar /backups/
node scripts/seguranca-supabase/resumir-diagnostico.mjs backups/seguranca/diagnostico-antes.json --backend NOME_DO_USUARIO
```

- `--backend`: só o **nome** anotado no passo A (sem senha; `postgres.<ref>` vira `postgres`). O resumidor recusa valores com `:`, `@` ou `/`.
- Ele mostra: protegido sim/não, dono e RLS das 6 tabelas, privilégios públicos, papéis que ignoram o RLS, conexões atuais e o veredito: **COMPATÍVEL** (o `02` basta) ou **ATENÇÃO** (rodar o `03` com esse papel antes do `02`).
- Também procura e-mails, URLs com credenciais, tokens e chaves; mostra só a localização mascarada. Com `ERRO`, troque o valor por `"<REMOVIDO>"`.
- Para me enviar, mande **só a saída do resumidor** (ou os campos `tabelas`, `acesso_dos_papeis_de_login`, `conexoes_por_usuario`), nunca chaves ou URLs.

## Ordem de aplicação (quando autorizado)

1. `01-diagnostico.sql` → anotar `protegido: false`, dono, usuários conectados.
2. Se o Render usar papel não-dono sem `BYPASSRLS`: `03-liberar-papel-backend.sql` (com o nome do papel) — antes do `02`, sem interrupção.
3. `02-aplicar-protecao.sql` (SQL Editor, como `postgres`).
4. `01-diagnostico.sql` → esperado `protegido: true`, RLS em todas, privilégios públicos vazios.
5. Testar o site: página inicial, mangá, leitor, comentários (leitura) e, se em uso, o painel antigo do Render (login e listagem). Ver logs do Render por erros de permissão.

## Recuperação

- **Site não lê/grava pelo Render** após o `02`: rodar o `03` com o papel do backend (não reabre acesso público). Confirmar com o `01`.
- **Problema não identificado e urgente:** `04-reverter-emergencia.sql` (volta ao estado inseguro anterior; reaplicar o `02` depois de corrigir).
- Os scripts só mexem em permissões e RLS: nenhum dado precisa ser restaurado.

## Testes locais

`tests/seguranca-supabase.test.js` (13 testes, PGlite = PostgreSQL 18 em memória, com a estrutura do esquema exportado, IDs `bigint`, privilégios padrão no estilo do Supabase, dono não-superusuário, dados fictícios). Os testes **agem como cada papel** (`SET ROLE`):

- antes: o furo existe (anon insere, apaga, lê ocultos; `PUBLIC` lê);
- depois do `02`: `anon`, `authenticated` e um papel só com `PUBLIC` recebem *permission denied* em `SELECT/INSERT/UPDATE/DELETE/TRUNCATE` nas 6 tabelas e em `nextval/setval`; nenhuma linha muda; idempotente;
- `service_role` e o dono continuam lendo (consultas de `/api/mangas` e `/api/comments`) e gravando (rotas do painel/Express);
- as 5 migrações aplicam depois do `02`, as RPCs funcionam para `service_role` e ninguém público executa nem lê as tabelas novas;
- backend não-dono quebra (0 linhas) e o diagnóstico mostra; o `03` corrige sem reabrir acesso público; recusa valor de exemplo e papel público;
- travas: executor errado, `service_role` sem `BYPASSRLS` e privilégio **herdado** abortam sem nenhuma mudança;
- o `04` restaura o acesso anterior sem reabrir funções, e o `02` pode ser reaplicado.

O `01` também foi executado em modo somente leitura no PostgreSQL 18 local (porta 55432). O cluster local não permite ao usuário de teste agir como `anon` (não é superusuário nem membro), por isso os testes de comportamento rodam no PGlite.

## Limitações

- Não testado no Supabase real (por regra). Comportamento do PostgREST não é simulado — só o do PostgreSQL, que é quem aplica RLS e privilégios.
- O `ALTER DEFAULT PRIVILEGES` vale para objetos criados pelo papel que executa o `02` (`postgres`); objetos criados por outros papéis administrativos do Supabase não são cobertos.
- `04` restaura o padrão do Supabase, não necessariamente cada privilégio individual anterior (guarde a saída do `01` de antes).

## Revisão final antes da aplicação (13/11/2026)

Base: `backups/seguranca/diagnostico-antes.json` (real, salvo pelo responsável; analisado só localmente).

### Comprovado pelo diagnóstico

- As 6 tabelas existem, pertencem a `postgres`, RLS desligado, sem políticas; nenhuma outra tabela em `public`.
- `anon` e `authenticated` têm `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` nas 6 tabelas e `SELECT, UPDATE, USAGE` nas 3 sequências. `PUBLIC` não tem nada. Sem herança de papéis para `anon`/`authenticated`. Nenhuma função em `public`.
- `postgres`: login, não superusuário, **`BYPASSRLS`** e **dono** das 6 tabelas — dois motivos independentes para ignorar o RLS.
- `service_role`: `BYPASSRLS` (Cloudflare).
- 48 privilégios padrão: 24 do dono `postgres` (tabelas, sequências, funções → `anon`/`authenticated`) e 24 do `supabase_admin` (idem).

### Hipótese (forte, ainda não observada)

- **O Render usa o papel `postgres`.** Evidência: o usuário do `DATABASE_URL` é `postgres.<ref>`, formato do pooler do Supabase em que o trecho antes do ponto é o papel do banco. Mas **nenhuma conexão do Render aparecia** no momento do diagnóstico (só PostgREST, pooler, painel e componentes internos). Para comprovar: `05-verificar-papel-render.sql` (somente leitura) usa o `pg_stat_statements` para mostrar qual papel executou as consultas típicas do Express. Esperado: `postgres` nos padrões `catalogo_mangas`/`capitulos_do_manga`.
- Se, contra o esperado, aparecer outro papel: rodar `01` de novo e, se ele não ignorar o RLS, aplicar o `03` com esse papel antes do `02`.

### Efeitos, dependências e reversão dos scripts

| Script | Efeitos | Dependências / travas | Reversão |
| --- | --- | --- | --- |
| `02` | RLS nas 6 tabelas; revoga tudo de `anon`/`authenticated`/`PUBLIC` em tabelas, sequências e `EXECUTE` de funções em `public`; remove privilégios padrão do papel executor | executar como `postgres`; `service_role` com `BYPASSRLS`; autoverificação; `lock_timeout` 5 s, `statement_timeout` 60 s; uma transação | `04` (testado: restaura exatamente o acesso anterior a tabelas/sequências e os padrões do dono, exceto `EXECUTE` em funções) |
| `03` | política `les_backend_acesso_total` + `SELECT/INSERT/UPDATE/DELETE` para UM papel de backend | nome real do papel; recusa papéis públicos | `DROP POLICY les_backend_acesso_total ON ...` + `REVOKE` desse papel (manual) |
| `04` | volta ao estado inseguro anterior | executar como `postgres` | reaplicar `02` |

### Riscos e lacunas

1. **Bloqueio durante a aplicação** (comprovado no PostgreSQL 18 local): `ENABLE ROW LEVEL SECURITY` pede `AccessExclusiveLock`; uma consulta longa faria o `ALTER` esperar e enfileirar o site. Mitigado: `SET LOCAL lock_timeout = '5s'` (falha rápida, nada muda; repetir depois). Tabelas pequenas: a operação em si leva milissegundos.
2. **Privilégios padrão do `supabase_admin`** continuam concedendo a `anon`/`authenticated` objetos que **esse** papel criar em `public`. O `postgres` não pode alterá-los. Mitigação: rodar o `01` após qualquer mudança de esquema (o campo `protegido` acusa); as migrações do projeto revogam explicitamente.
3. **`schema_migrations` e a tabela de backup antiga** ficam protegidas pelo `02` (não legíveis por papéis públicos).
4. **Clientes com a chave *anon*** passam a receber erro de permissão (intencional; nenhum no código).
5. **Supabase Realtime/GraphQL** com a chave *anon* também deixam de ver as tabelas (não usados pelo site).
6. Testado em PGlite (PostgreSQL 18) e com verificações somente leitura no PostgreSQL 18 local; o Supabase usa PostgreSQL 17 — as regras de RLS/privilégios envolvidas são as mesmas nas duas versões.

### Backup antes de aplicar

O `02` só altera permissões e RLS, não dados. Ainda assim, antes de aplicar:

1. **Estado das permissões:** `backups/seguranca/diagnostico-antes.json` (já salvo) registra todo o acesso público anterior; o `04` foi testado para restaurá-lo.
2. **Esquema com permissões** (o responsável roda, com a própria string de conexão, sem compartilhá-la):
   `pg_dump --schema-only --schema=public "<DATABASE_URL>" > backups/seguranca/esquema-antes.sql` — inclui `GRANT`/`REVOKE`/RLS. Ou `supabase db dump` (CLI).
3. **Dados** (recomendado, contém comentários de leitores — dado pessoal; nunca compartilhar):
   `pg_dump --data-only --schema=public -Fc "<DATABASE_URL>" > backups/seguranca/dados-antes.dump`.
4. `chmod 600 backups/seguranca/*` e conferir `git check-ignore -v`. Eu posso validar localmente, sem conexão, que os arquivos são legíveis (`pg_restore --list`, contagem de `GRANT`/tabelas) — sem abrir os dados.
5. Verificar no painel do Supabase (*Database → Backups*) se o plano tem backups automáticos e a data do último.

### Plano de execução controlada (quando autorizado)

**Antes (somente leitura):**
1. Backup (itens acima) validado.
2. Usar o site publicado por alguns minutos (página inicial, um capítulo, comentários).
3. `05-verificar-papel-render.sql` → confirmar `postgres` nos padrões do Express.
4. `01-diagnostico.sql` → salvar como `diagnostico-antes-2.json`; `resumir-diagnostico.mjs ... --backend postgres` → COMPATÍVEL; comparar com o diagnóstico anterior (sem mudanças inesperadas).
5. Escolher horário de pouco acesso.

**Aplicar:**
6. SQL Editor, como `postgres`: colar `02-aplicar-protecao.sql` inteiro e executar uma vez. Se der *lock timeout*, esperar e repetir.

**Depois (somente leitura + uso do site):**
7. `01-diagnostico.sql` → `protegido: true`, RLS ligado nas 6, privilégios públicos vazios, padrões do `postgres` removidos (restam só os do `supabase_admin`).
8. Site publicado: página inicial, página do mangá, leitor, lista de comentários; se em uso, login no painel antigo e listagem. Logs do Render sem `permission denied`.
9. (Opcional) Teste negativo com a chave *anon*: uma leitura REST deve falhar. Só se você quiser e sem expor a chave.

**Se algo falhar:** dados intactos; rodar o `03` com o papel identificado (sem reabrir acesso) ou, em último caso, o `04`; repetir o `01` para confirmar.
