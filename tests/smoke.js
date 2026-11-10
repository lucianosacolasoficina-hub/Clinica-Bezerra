// Teste automático: abre o sistema publicado em public/ com um banco simulado,
// faz o primeiro acesso, passa por todas as telas e falha se aparecer qualquer erro.
// Uso: node tests/smoke.js   (precisa do pacote playwright com o Chromium)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const EMAIL = 'teste@clinica.local', UID = '11111111-1111-1111-1111-111111111111';
const jwt = () => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: UID, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
const db = new Map(), falhas = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
(async () => {
  const br = await chromium.launch();
  for (const [larg, alt] of [[1366, 860], [390, 800]]) {
    const ctx = await br.newContext({ viewport: { width: larg, height: alt } }); const pg = await ctx.newPage();
    pg.on('pageerror', e => falhas.push(`[${larg}px] erro de script: ${e.message}`));
    await ctx.route('**/*', async r => {
      const u = new URL(r.request().url()), m = r.request().method();
      const json = (b, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b), headers: cors });
      if (u.hostname === 'app.local') { const f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname); return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404 }); }
      if (u.hostname.endsWith('supabase.co')) {
        if (m === 'OPTIONS') return r.fulfill({ status: 200, headers: cors });
        if (u.pathname === '/auth/v1/token') return json({ access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt', user });
        if (u.pathname === '/auth/v1/user') return json(user);
        if (u.pathname === '/rest/v1/rpc/sistema_vazio') return json(![...db.keys()].some(k => k.startsWith('colab|')));
        if (u.pathname === '/rest/v1/rpc/meu_colab') { const c = [...db.entries()].find(([k, v]) => k.startsWith('colab|') && v.email === EMAIL); return json(c ? c[1] : null); }
        if (u.pathname === '/rest/v1/registros' && m === 'GET') return json([...db.entries()].map(([k, v]) => ({ colecao: k.split('|')[0], id: k.split('|').slice(1).join('|'), dados: v })));
        if (u.pathname === '/rest/v1/registros' && m === 'POST') { JSON.parse(r.request().postData()).forEach(x => db.set(x.colecao + '|' + x.id, x.dados)); return r.fulfill({ status: 201, body: '', headers: cors }); }
        if (u.pathname === '/rest/v1/registros' && m === 'DELETE') return r.fulfill({ status: 204, body: '', headers: cors });
        if (u.pathname.startsWith('/rest/v1/acessos')) return m === 'GET' ? json([]) : r.fulfill({ status: 201, body: '', headers: cors });
        if (u.pathname.startsWith('/functions/v1/')) return json({ ok: true, pedidos: [] });
        return json({});
      }
      if (/cdnjs|googleapis|gstatic/.test(u.hostname)) return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      return r.abort();
    });
    await pg.goto('https://app.local/');
    if (larg === 1366) { // primeiro acesso: cria o administrador
      await pg.fill('#au-mail', EMAIL); await pg.fill('#au-pass', 'senha12345'); await pg.click('#au-btn');
    } else { await pg.evaluate(() => {}); await pg.fill('#au-mail', EMAIL); await pg.fill('#au-pass', 'senha12345'); await pg.click('#au-btn'); }
    await pg.waitForSelector('.app:not([hidden])', { timeout: 15000 }).catch(() => falhas.push(`[${larg}px] o sistema não abriu depois do login`));
    await pg.waitForTimeout(1500);
    const sync = await pg.evaluate(() => document.querySelector('#sync')?.textContent || '');
    if (!/Tudo salvo/.test(sync)) falhas.push(`[${larg}px] não conseguiu salvar: "${sync}"`);
    const telas = await pg.evaluate(() => [...document.querySelectorAll('#nav button[data-v]')].filter(b => !b.hidden).map(b => b.dataset.v));
    if (telas.length < 5) falhas.push(`[${larg}px] menu com poucas telas: ${telas.join(', ')}`);
    for (const v of telas) {
      await pg.evaluate(v => go(v), v); await pg.waitForTimeout(120);
      const vazio = await pg.evaluate(() => (document.querySelector('#view')?.innerText || '').trim().length < 10);
      if (vazio) falhas.push(`[${larg}px] a tela "${v}" ficou vazia`);
      const largura = await pg.evaluate(() => document.documentElement.scrollWidth);
      if (largura > larg + 2) falhas.push(`[${larg}px] a tela "${v}" passou da largura da tela (${largura}px)`);
    }
    for (const a of ['dia', 'semana', 'mes']) { await pg.evaluate(a => { go('agenda'); window.agIr && agIr(a) }, a); await pg.waitForTimeout(80); }
    for (const t of ['rose', 'noite', 'classico']) await pg.evaluate(t => window.aplicaTema && aplicaTema(t), t);
    if (await pg.$('#cora-btn')) { await pg.click('#cora-btn'); for (const q of ['oi', 'agenda hoje', 'horários livres amanhã', 'faturamento']) { await pg.fill('#cora-in', q); await pg.press('#cora-in', 'Enter'); await pg.waitForTimeout(60); } }
    else falhas.push(`[${larg}px] botão da Cora sumiu`);
    await pg.screenshot({ path: path.join(__dirname, `tela-${larg}.png`) });
    await ctx.close();
  }
  await br.close();
  if (falhas.length) { console.error('FALHOU:\n- ' + falhas.join('\n- ')); process.exit(1); }
  console.log('OK: sistema abriu, salvou e todas as telas carregaram sem erro.');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
