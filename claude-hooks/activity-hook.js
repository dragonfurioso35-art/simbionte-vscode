#!/usr/bin/env node
// PostToolUse hook (matcher: Edit|Write|Bash) — grava arquivo tocado e
// recalcula progresso de plano (- [ ]/- [x]) pro Simbionte, em disco.
//
// REGRA DE OURO (2026-08-26): nunca deixar o Simbionte desatualizado por eu
// ter editado um plano via Bash/script em vez de Edit/Write — esta trava
// cobre esse caso (busca o caminho de um plano no texto do comando Bash).
const path = require('path');
const { resolverProjeto, resolverProjetoAtivo, atualizarProgresso, registrarAtividade, registrarHeartbeat, progressoDoPlano, projetosExtrasDoPlano, registrarToque } = require('./simbionte-store');

function extrairPlanoDoComandoBash(comando) {
  if (!comando) return null;
  const match = comando.match(/[^\s"'`]*docs[\\/]superpowers[\\/]plans[\\/][^\s"'`]*\.md/i);
  return match ? match[0] : null;
}

let input = '';
process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    registrarHeartbeat();
    const fileDireto = data.tool_input?.file_path;
    const filePlano = fileDireto || extrairPlanoDoComandoBash(data.tool_input?.command);

    // Bash genérico (docker, script de verificação, etc.) não tem
    // file_path nem referencia um plano — antes disso era "return" direto
    // sem registrar nada. Agora resolve por cwd (igual progress-hook.js já
    // fazia pro TodoWrite) pra pelo menos contar como "você tá ativo aqui".
    const proj = (filePlano && resolverProjeto(filePlano))
      || resolverProjetoAtivo(data.cwd || process.cwd());
    if (!proj) return process.exit(0);

    registrarToque(proj.id, proj.name, proj.path);

    if (fileDireto) {
      registrarAtividade(proj.id, proj.name, {
        file: path.basename(fileDireto), path: path.resolve(fileDireto), tool: data.tool_name || '?', ts: Date.now(),
      }, proj.path);
    }
    if (filePlano) {
      const progresso = progressoDoPlano(filePlano);
      if (progresso) {
        const origem = fileDireto ? 'edit' : 'bash';
        atualizarProgresso(proj.id, proj.name, progresso, proj.path, origem);
        // Plano que cobre mais de um repo: mesmo progresso nos outros projetos.
        projetosExtrasDoPlano(filePlano).forEach(p => {
          if (p.id !== proj.id) atualizarProgresso(p.id, p.name, progresso, p.path, origem);
        });
      }
    }
  } catch (e) { /* payload inválido ou projeto não reconhecido — ignora */ }
  process.exit(0);
});
