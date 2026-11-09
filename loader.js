/* Clínica Bezerra · conexão com o banco (Supabase), login e sincronização */
window.ONLINE = true;
const CB = window.CB_CONFIG || {};
const sb = window.supabase.createClient(CB.url, CB.key, { auth: { persistSession: true, autoRefreshToken: true } });
const ARR = ['procs','pacientes','ag','fin','evol','colab','forn','estoque','mov','pacotes','termos','nf','camp'];
const OBJ = ['clinica','perms','online','fidel'];
const snap = new Map();
const q$ = s => document.querySelector(s);

/* ---------- download de arquivos (PDF) ---------- */
window.DL = { save({ filename, data }) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); return Promise.resolve({ status: 'saved' });
} };

/* ---------- tela de login ---------- */
let modo = 'entrar';
function msgAuth(t, erro) { const m = q$('#au-msg'); m.textContent = t || ''; m.className = 'au-msg' + (erro ? ' err' : ''); }
function trocaModo(m) {
  modo = m; q$('#au-t').textContent = { entrar: 'Entrar', criar: 'Primeiro acesso', esqueci: 'Recuperar senha', nova: 'Criar nova senha' }[m];
  q$('#au-pass-w').hidden = m === 'esqueci'; q$('#au-mail-w').hidden = m === 'nova';
  q$('#au-btn').textContent = { entrar: 'Entrar', criar: 'Criar minha senha', esqueci: 'Enviar link por e-mail', nova: 'Salvar nova senha' }[m];
  q$('#au-pass').autocomplete = m === 'entrar' ? 'current-password' : 'new-password';
  q$('#au-links').hidden = m === 'nova'; msgAuth('');
}
window.trocaModo = trocaModo;
q$('#au-form').addEventListener('submit', async e => {
  e.preventDefault(); const email = q$('#au-mail').value.trim(), senha = q$('#au-pass').value; const b = q$('#au-btn'); b.disabled = true;
  try {
    if (modo === 'entrar') { const { error } = await sb.auth.signInWithPassword({ email, password: senha }); if (error) throw error; }
    else if (modo === 'criar') {
      if (senha.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.');
      const { data, error } = await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin + location.pathname } }); if (error) throw error;
      if (!data.session) msgAuth('Enviamos um e-mail de confirmação para ' + email + '. Abra o link e depois entre com sua senha.');
    } else if (modo === 'esqueci') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error;
      msgAuth('Se o e-mail estiver cadastrado, você vai receber um link para criar nova senha.');
    } else if (modo === 'nova') {
      if (senha.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.');
      const { error } = await sb.auth.updateUser({ password: senha }); if (error) throw error; msgAuth('Senha atualizada.'); iniciar();
    }
  } catch (err) { msgAuth(traduz(err.message), true); }
  b.disabled = false;
});
function traduz(m) {
  if (/Invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered/i.test(m)) return 'Este e-mail já tem senha. Use Entrar ou Esqueci a senha.';
  if (/rate limit/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (/fetch/i.test(m)) return 'Sem conexão com a internet.';
  return m;
}

/* ---------- carga dos dados ---------- */
async function carregar() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('registros').select('colecao,id,dados').range(from, from + 999);
    if (error) throw error; rows.push(...data); if (data.length < 1000) break;
  }
  const db = {}; ARR.forEach(k => db[k] = []);
  rows.forEach(r => { snap.set(r.colecao + '|' + r.id, JSON.stringify(r.dados)); if (r.colecao === 'config') db[r.id] = r.dados; else (db[r.colecao] = db[r.colecao] || []).push(r.dados); });
  const { data: logs } = await sb.from('acessos').select('quando,nome,perfil,acao').order('quando', { ascending: false }).limit(300);
  db.log = (logs || []).map(l => ({ q: l.quando, u: l.nome, perfil: l.perfil, acao: l.acao }));
  return db;
}

/* ---------- gravação: só o que mudou, registro por registro ---------- */
function linhas(db) {
  const m = new Map();
  ARR.forEach(k => (db[k] || []).forEach(o => { if (!o.id) o.id = Math.random().toString(36).slice(2, 10); m.set(k + '|' + o.id, o); }));
  OBJ.forEach(k => { if (db[k]) m.set('config|' + k, db[k]); });
  return m;
}
let timer = null, fila = Promise.resolve(), erroAberto = false;
function status(t, erro) { const s = q$('#sync'); if (s) { s.textContent = t; s.classList.toggle('err', !!erro); } }
async function flush() {
  const cur = linhas(db); const up = [], del = [];
  cur.forEach((o, k) => { const j = JSON.stringify(o); if (snap.get(k) !== j) { const i = k.indexOf('|'); up.push({ k, j, row: { colecao: k.slice(0, i), id: k.slice(i + 1), dados: o } }); } });
  snap.forEach((j, k) => { if (!cur.has(k) && !k.startsWith('config|')) del.push(k); });
  if (!up.length && !del.length) return;
  status('Salvando…');
  const ordem = c => c === 'colab' ? 0 : c === 'config' ? 1 : 2;
  up.sort((a, b) => ordem(a.row.colecao) - ordem(b.row.colecao));
  try {
    // colaboradores, depois configurações, depois o resto: cada grupo num envio separado,
    // porque o banco só libera o resto depois que o colaborador já está gravado
    const grupos = [0, 1, 2].map(n => up.filter(x => ordem(x.row.colecao) === n));
    const lotes = []; grupos.forEach(g => { for (let i = 0; i < g.length; i += 100) lotes.push(g.slice(i, i + 100)); });
    for (const lote of lotes) {
      const { error } = await sb.from('registros').upsert(lote.map(x => x.row));
      if (error) throw error; lote.forEach(x => snap.set(x.k, x.j));
    }
    const porCol = {}; del.forEach(k => { const i = k.indexOf('|'); (porCol[k.slice(0, i)] = porCol[k.slice(0, i)] || []).push(k.slice(i + 1)); });
    for (const [c, ids] of Object.entries(porCol)) {
      const { error } = await sb.from('registros').delete().eq('colecao', c).in('id', ids);
      if (error) throw error; ids.forEach(id => snap.delete(c + '|' + id));
    }
    status('Tudo salvo'); erroAberto = false;
  } catch (err) {
    const semNet = !navigator.onLine || /fetch/i.test(err.message || '');
    status(semNet ? 'Sem internet. Vou tentar de novo' : 'Não foi possível salvar', true);
    if (!semNet && !erroAberto) { erroAberto = true; window.toast && toast('Não foi possível salvar: ' + (/row-level|permission/i.test(err.message) ? 'seu perfil não tem permissão para essa alteração' : err.message) + '. Recarregando os dados.'); setTimeout(() => location.reload(), 2500); }
  }
}
window.SYNC = {
  save() { clearTimeout(timer); timer = setTimeout(() => { fila = fila.then(flush); }, 350); return true; },
  log(nome, perfil, acao) { sb.from('acessos').insert({ nome, perfil, acao }).then(() => {}); }
};
window.addEventListener('online', () => window.SYNC.save());
window.addEventListener('beforeunload', e => { if (timer) { clearTimeout(timer); flush(); } });

/* ---------- atualização ao vivo vinda de outros computadores ---------- */
let precisaRender = false;
function aoVivo() {
  sb.channel('registros').on('postgres_changes', { event: '*', schema: 'public', table: 'registros' }, p => {
    const r = p.eventType === 'DELETE' ? p.old : p.new; if (!r || !r.colecao) return; const k = r.colecao + '|' + r.id;
    if (p.eventType === 'DELETE') {
      if (!snap.has(k)) return; snap.delete(k); if (db[r.colecao]) db[r.colecao] = db[r.colecao].filter(x => x.id !== r.id);
    } else {
      const j = JSON.stringify(r.dados); if (snap.get(k) === j) return; snap.set(k, j);
      if (r.colecao === 'config') db[r.id] = r.dados;
      else { const a = db[r.colecao] = db[r.colecao] || []; const i = a.findIndex(x => x.id === r.id); if (i >= 0) a[i] = r.dados; else a.push(r.dados); }
    }
    if (document.getElementById('dlg').open) precisaRender = true; else render();
  }).subscribe();
  document.getElementById('dlg').addEventListener('close', () => { if (precisaRender) { precisaRender = false; render(); } });
}

/* ---------- início ---------- */
window.sairSistema = async () => { await sb.auth.signOut(); location.reload(); };
window.confirmaSenha = async (senha) => { const { error } = await sb.auth.signInWithPassword({ email: window.__USER.email, password: senha }); return !error; };
let iniciado = false;
async function iniciar() {
  if (iniciado) return; iniciado = true;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { iniciado = false; q$('#auth').hidden = false; q$('#carregando').hidden = true; return; } window.__USER = session.user; q$('#auth').hidden = true; q$('#carregando').hidden = false;
  try {
    const { data: vazio, error: e1 } = await sb.rpc('sistema_vazio'); if (e1) throw e1;
    const { data: eu } = await sb.rpc('meu_colab');
    if (!vazio && !eu) {
      q$('#carregando').innerHTML = `<div class="au-card"><h1>Acesso não liberado</h1><p>O e-mail <b>${session.user.email.replace(/</g, '&lt;')}</b> ainda não está cadastrado como colaborador ativo. Peça ao administrador para cadastrar você em Administração, Colaboradores, com este mesmo e-mail.</p><button class="btn" onclick="sairSistema()">Sair</button></div>`;
      return;
    }
    window.__DB = vazio ? null : await carregar();
    const s = document.createElement('script'); s.textContent = document.getElementById('app-src').textContent; document.body.appendChild(s);
    q$('#carregando').hidden = true; q$('.app').hidden = false;
    aoVivo(); log('Entrou no sistema'); status('Tudo salvo');
  } catch (err) {
    q$('#carregando').innerHTML = `<div class="au-card"><h1>Não foi possível abrir</h1><p>${traduz(err.message || String(err)).replace(/</g, '&lt;')}</p><button class="btn" onclick="location.reload()">Tentar de novo</button></div>`;
  }
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') { q$('#auth').hidden = false; q$('#carregando').hidden = true; trocaModo('nova'); } else if (ev === 'SIGNED_IN') setTimeout(iniciar, 0); }); // fora do aviso de login, senão a biblioteca trava esperando a si mesma
iniciar();
// rede de segurança: se travar no "Carregando…", oferece tentar de novo
setTimeout(() => { const c = q$('#carregando'); if (c && !c.hidden && q$('.app').hidden && /Carregando/.test(c.textContent)) c.innerHTML = '<div class="au-card"><h1>Está demorando…</h1><p>Não consegui abrir o sistema. Verifique a internet e tente de novo.</p><button class="btn" onclick="location.reload()">Tentar de novo</button> <button class="btn ghost" onclick="sairSistema()">Sair e entrar de novo</button></div>'; }, 20000);

/* ---------- instalar como aplicativo ---------- */
let pedidoInstalar = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalar = e; const b = q$('#instalar'); if (b) b.hidden = false; });
window.instalarApp = async () => { if (!pedidoInstalar) return; pedidoInstalar.prompt(); await pedidoInstalar.userChoice; pedidoInstalar = null; q$('#instalar').hidden = true; };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
