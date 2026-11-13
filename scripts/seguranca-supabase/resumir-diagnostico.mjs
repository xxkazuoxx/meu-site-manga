// Lê, só localmente, o resultado de 01-diagnostico.sql salvo do SQL Editor e
// imprime um resumo + a varredura de dados sensíveis (valores mascarados).
// Não conecta a nenhum banco.
//
// Uso: node scripts/seguranca-supabase/resumir-diagnostico.mjs backups/seguranca/diagnostico-antes.json [--backend NOME_DO_USUARIO]
//   --backend: só o NOME de usuário do DATABASE_URL do Render (nunca a senha/URL).
//              No pooler do Supabase o usuário aparece como "postgres.<ref>": informe só "postgres".
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { scanSensitive } from '../fase-d/verificar-arquivo.mjs'

export const SITE_TABLES = ['mangas', 'chapters', 'pages', 'comments', 'schema_migrations', 'pages_backup_cloudinary_before_public_id']
const EXPECTED = ['papel_atual', 'tabelas', 'papeis', 'acesso_dos_papeis_de_login', 'privilegios_publicos_tabelas', 'protegido']

// Aceita: célula colada, cópia JSON da grade ([{"diagnostico": "..."}]), {diagnostico} ou CSV.
export function normalizeDiagnostic(text) {
  const trimmed = String(text).replace(/^﻿/, '').trim()
  let data
  if (/^diagnostico\s*\r?\n/i.test(trimmed)) {
    const field = trimmed.replace(/^diagnostico\s*\r?\n/i, '').trim()
    data = JSON.parse(field.startsWith('"') ? field.slice(1, -1).replace(/""/g, '"') : field)
  } else data = JSON.parse(trimmed)
  if (Array.isArray(data)) {
    if (data.length !== 1 || !data[0] || !('diagnostico' in data[0])) throw new Error('Esperada uma única linha com a coluna "diagnostico".')
    data = data[0].diagnostico
  } else if (data && typeof data === 'object' && 'diagnostico' in data && !('tabelas' in data)) data = data.diagnostico
  if (typeof data === 'string') data = JSON.parse(data)
  const missing = EXPECTED.filter(key => !(key in (data ?? {})))
  if (missing.length) throw new Error(`Chaves ausentes (consulta alterada ou resultado truncado?): ${missing.join(', ')}`)
  return data
}

// Decide a compatibilidade do backend do Render com a proteção (02).
export function backendVerdict(diag, backend) {
  if (!backend) return null
  const name = backend.replace(/\..*$/, '') // "postgres.<ref>" (pooler) -> "postgres"
  if (['anon', 'authenticated'].includes(name)) {
    return { ok: false, message: `O backend usa o papel público "${name}": inseguro e incompatível. Não aplique o 02; revise a configuração do Render.` }
  }
  const role = (diag.acesso_dos_papeis_de_login ?? []).find(item => item.papel === name)
  if (!role) return { ok: false, message: `Papel "${name}" não aparece entre os papéis de login. Confira o nome (sem senha) e rode o diagnóstico com o Render ativo.` }
  if (role.ignora_rls) return { ok: true, message: `Papel "${name}" ignora o RLS (${role.motivo}): o Render continua funcionando após o 02. O 03 não é necessário.` }
  return { ok: false, message: `Papel "${name}" NÃO ignora o RLS: aplicar o 02 sozinho quebraria o Render. Rode antes 03-liberar-papel-backend.sql com v_role = '${name}'.` }
}

export function summarize(diag, { backend } = {}) {
  const lines = []
  const tables = new Map((diag.tabelas ?? []).map(table => [table.tabela, table]))
  lines.push(`Protegido: ${diag.protegido ? 'SIM' : 'NÃO'}  (papel que executou: ${diag.papel_atual})`)
  lines.push('Tabelas do site (dono · RLS):')
  for (const name of SITE_TABLES) {
    const table = tables.get(name)
    lines.push(table ? `  - ${name}: ${table.dono} · RLS ${table.rls ? 'ligado' : 'DESLIGADO'}${table.rls_forcado ? ' (forçado)' : ''}` : `  - ${name}: AUSENTE`)
  }
  const others = [...tables.keys()].filter(name => !SITE_TABLES.includes(name))
  if (others.length) lines.push(`Outras tabelas em public: ${others.join(', ')}`)
  const exposed = (diag.privilegios_publicos_tabelas ?? []).filter(row => row.privilegios)
  lines.push(exposed.length ? 'Privilégios públicos efetivos:' : 'Privilégios públicos efetivos: nenhum')
  for (const row of exposed) lines.push(`  - ${row.papel} em ${row.tabela}: ${row.privilegios.join(', ')}`)
  const seq = (diag.privilegios_publicos_sequencias ?? []).filter(row => row.privilegios)
  if (seq.length) lines.push(`Sequências acessíveis a papéis públicos: ${seq.length}`)
  const fns = diag.funcoes_executaveis_por_publicos ?? []
  if (fns.length) lines.push(`Funções executáveis por papéis públicos: ${[...new Set(fns.map(fn => fn.funcao))].join(', ')}`)
  if (diag.heranca_publica?.length) lines.push(`Herança: ${diag.heranca_publica.map(item => `${item.papel} ⊂ ${item.membro_de}`).join(', ')}`)
  lines.push('Papéis de login que ignoram o RLS:')
  for (const role of diag.acesso_dos_papeis_de_login ?? []) if (role.ignora_rls) lines.push(`  - ${role.papel} (${role.motivo})`)
  lines.push('Conexões agora (usuário · aplicação · quantidade):')
  for (const item of diag.conexoes_por_usuario ?? []) lines.push(`  - ${item.usuario} · ${item.aplicacao || '(sem nome)'} · ${item.conexoes}`)
  if (!(diag.conexoes_por_usuario ?? []).length) lines.push('  (nenhuma — o Render pode estar hibernando; acesse o site e rode o diagnóstico de novo)')
  const defaults = diag.privilegios_padrao_publicos ?? []
  lines.push(`Privilégios padrão para objetos futuros concedidos a papéis públicos: ${defaults.length}`)
  lines.push(`Políticas RLS: ${(diag.politicas_rls ?? []).length}`)
  const verdict = backendVerdict(diag, backend)
  if (verdict) lines.push(`Backend do Render: ${verdict.ok ? 'COMPATÍVEL' : 'ATENÇÃO'} — ${verdict.message}`)
  return lines.join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.error('Uso: node scripts/seguranca-supabase/resumir-diagnostico.mjs <arquivo> [--backend NOME_DO_USUARIO]')
    process.exit(2)
  }
  const index = process.argv.indexOf('--backend')
  const backend = index > 0 ? process.argv[index + 1] : undefined
  if (backend && /[:@/]/.test(backend)) {
    console.error('Informe só o NOME do usuário (sem senha, ":" , "@" ou URL).')
    process.exit(2)
  }
  let diag
  try {
    diag = normalizeDiagnostic(await readFile(file, 'utf8'))
  } catch (error) {
    console.error(`Formato inválido: ${error.message}`)
    process.exit(1)
  }
  const scan = scanSensitive(diag)
  console.log(summarize(diag, { backend }))
  for (const item of scan.errors) console.log(`ERRO (dado sensível): ${item}`)
  for (const item of scan.warnings) console.log(`AVISO: ${item}`)
  console.log(scan.errors.length ? 'Remova os itens acima (substitua por "<REMOVIDO>") antes de compartilhar.' : 'Nenhuma credencial/dado pessoal detectado automaticamente (revise mesmo assim).')
  process.exitCode = scan.errors.length ? 1 : 0
}
