# Meu Site Manga

Aplicação web para catálogo de mangás, capítulos e leitura de páginas. O frontend usa React e Vite; a API e o servidor de arquivos usam Express; os dados são armazenados em SQLite via `better-sqlite3`.

## Requisitos

- Node.js 24 (compatível com a versão usada no desenvolvimento) e npm.
- Dependências npm instaladas; `better-sqlite3` pode exigir ferramentas de compilação nativas caso não haja binário pré-compilado para a plataforma.
- Não é necessário instalar um serviço SQLite separado: o driver incluído no projeto acessa o arquivo local.

## Instalação e configuração inicial

Na raiz do projeto:

```sh
npm install
cp .env.example .env
```

O `.env` local não deve ser versionado. Configure nele os valores administrativos e um segredo de sessão forte antes de usar o painel. Não coloque segredos em código frontend, `VITE_*`, README ou repositórios públicos. Se já existir `.env`, preserve-o e ajuste apenas as variáveis necessárias.

O servidor inicializa/cria o SQLite no caminho configurado, cria tabelas-base e executa as migrações de comentários existentes em `migrations/`. O caminho padrão é `data/manga.db`; a aplicação não move um banco existente.

## Desenvolvimento

Abra dois terminais na raiz do projeto:

```sh
npm run start
npm run dev
```

O Express usa por padrão `127.0.0.1:3001`. O Vite usa a porta padrão `5173` e encaminha `/api`, `/manga` e `/manga-uploads` ao backend. Abra a URL local exibida pelo Vite. Para mudar o destino do proxy, configure `API_PROXY_TARGET` no ambiente do Vite.

## Build e execução local do build

```sh
npm run build
npm run start
```

O build gera `dist/`. O Express serve `public/` e, quando presente, o frontend compilado em `dist/`, além da API. O script `npm run preview` é o preview do Vite; para validar a combinação real de API, uploads e build, use o servidor Express após gerar `dist/`.

Scripts disponíveis:

- `npm run dev`: Vite em desenvolvimento.
- `npm run build`: build de produção do frontend.
- `npm run start`: servidor Express/API e frontend compilado.
- `npm run lint`: ESLint do projeto.
- `npm run preview`: preview isolado do build Vite.

## Configuração de ambiente

As variáveis são opcionais quando indicado; os defaults permitem o desenvolvimento local. Não publique os valores secretos.

| Variável | Uso | Default |
| --- | --- | --- |
| `HOST` | Interface de rede de escuta do Express; mantenha loopback para uso apenas local. | `127.0.0.1` |
| `PORT` | Porta HTTP do Express. | `3001` |
| `PUBLIC_URL` | Origem de frontend permitida pela configuração CORS. | `http://localhost:5173` |
| `DATABASE_PATH` | Caminho do arquivo SQLite, relativo à raiz do projeto ou absoluto. | `data/manga.db` |
| `API_PROXY_TARGET` | Origem do backend usada pelo proxy de desenvolvimento/preview do Vite. | `http://127.0.0.1:3001` |
| `NODE_ENV` | Modo do Node/Express; também controla a flag segura de cookie. | definido pelo ambiente |
| `SESSION_SECRET` | Segredo usado para assinar sessões administrativas. | obrigatório para sessões seguras |
| `ADMIN_USERNAME` | Nome de usuário administrativo configurado no servidor. | configurar localmente |
| `ADMIN_PASSWORD_HASH` | Hash da senha administrativa esperado pelo servidor. | configurar localmente |

`SESSION_SECRET`, `ADMIN_USERNAME` e `ADMIN_PASSWORD_HASH` são configurações de servidor. Nunca use prefixo `VITE_` nesses segredos.

## Estrutura principal

- `src/`: frontend React, páginas e componentes.
- `server.js`: API Express, autenticação, comentários, uploads e arquivos estáticos.
- `database.js`, `migrations/`: inicialização SQLite e migrações.
- `data/`: banco local e área temporária de uploads.
- `public/manga/`: capas e ativos estáticos oficiais.
- `public/manga-uploads/`: páginas de capítulos armazenadas localmente.
- `dist/`: saída gerada pelo build.
- `backups/`: cópias locais de recuperação criadas durante as etapas de manutenção; não é sincronizada automaticamente.

## Uploads, banco e backups

As páginas enviadas são armazenadas sob `public/manga-uploads/<manga>/<capitulo>/`; as URLs canônicas começam com `/manga-uploads/`. Capas e demais ativos estáticos podem permanecer em `public/manga/`. Esses diretórios contêm dados locais e devem ser incluídos no plano de backup apropriado antes de manutenção ou deploy.

O SQLite usa `data/manga.db` por padrão. Migrações estão em `migrations/` e são aplicadas pelo inicializador do banco. Faça uma cópia consistente do banco e preserve os arquivos de upload em conjunto; não copie apenas o banco durante gravações ativas. Os backups existentes em `backups/` são material local de recuperação, não substituem uma rotina de backup externa validada.

## Segurança e preparação para deploy

- Mantenha `.env` privado e fora do controle de versão; `.env.example` contém apenas nomes e valores demonstrativos.
- Não exponha credenciais, hashes, tokens ou segredos no frontend, logs ou documentação pública.
- O default de escuta é loopback. Uma configuração de host publicamente acessível exige revisão de firewall, HTTPS, CORS, cookies, sessões, armazenamento persistente e estratégia de backup.
- O deploy ainda requer validação específica do ambiente de produção. Build bem-sucedido não significa que o projeto foi validado ou está pronto para produção; deploy não foi realizado por esta documentação.
