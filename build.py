#!/usr/bin/env python3
"""Gera a versão online (public/) a partir do protótipo clinica-bezerra.html.
Uso: python3 build.py   (lê prototipo/clinica-bezerra.html, loader.js e config.js)"""
import re, os, json, shutil
AQUI = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(AQUI, 'prototipo', 'clinica-bezerra.html'), encoding='utf-8').read()
loader = open(os.path.join(AQUI, 'loader.js'), encoding='utf-8').read()
OUT = os.path.join(AQUI, 'public'); os.makedirs(OUT, exist_ok=True)

style = re.search(r'<style>(.*?)</style>', src, re.S).group(1)
body = re.search(r'</style>\s*(.*?)<script>\n', src, re.S).group(1)
main = re.search(r'<script>\n(.*)</script>\s*$', src, re.S).group(1)

def rep(s, a, b, n=1):
    assert a in s, 'não encontrei: ' + a[:90]
    return s.replace(a, b) if n == 0 else s.replace(a, b, n)

# ---------- ajustes no código principal para rodar ligado ao banco ----------
m = main
m = rep(m, "try{db=JSON.parse(localStorage.getItem('cb-demo-v1'))}catch(e){}", "db=window.__DB;")
m = rep(m, "if(!db||!db.procs)db=seed();", "if(!db||!db.procs){db=seed();db.pacientes=[];db.ag=[];db.fin=[];db.__novo=true}")
m = rep(m, "const save=()=>{try{localStorage.setItem('cb-demo-v1',JSON.stringify(db));return true}catch(e){return false}};", "const save=()=>window.SYNC.save(db);")
m = re.sub(r"\$\('#reset'\)\.onclick=\(\)=>\{[^\n]*\n", "", m, count=1)
m = rep(m, "if(!db.evol){db.evol=seedEvol();save()}", "if(!db.evol)db.evol=[];")
m = rep(m, "if(!db.colab){Object.assign(db,seedAdmin());save()}",
 "if(!db.colab||db.__novo){Object.assign(db,seedAdmin());const em=window.__USER.email;db.colab=[{...db.colab[0],id:'u'+Math.random().toString(36).slice(2,8),nome:em.split('@')[0],exib:em.split('@')[0],email:em,cpf:'',nasc:'',tel:'',cargo:'Administrador(a)',esp:'',conselho:'',regnum:'',reguf:'',atende:false,vinc:'Sócio(a)',admissao:T,pin:''}];db.forn=[];db.log=[];db.clinica.rt=''}")
m = rep(m, "let me='u1',adminOk=false;try{me=sessionStorage.getItem('cb-me')||'u1'}catch(e){}",
 "let me=(db.colab.find(c=>(c.email||'').toLowerCase()===window.__USER.email.toLowerCase())||{}).id,adminOk=false;")
m = rep(m, "const ME=()=>db.colab.find(c=>c.id===me)||db.colab[0];", "const ME=()=>db.colab.find(c=>c.id===me)||{nome:window.__USER.email,exib:window.__USER.email,perfil:'nenhum',cor:'#888888'};")
m = rep(m, "function log(acao){db.log.unshift({q:new Date().toISOString(),u:ME().nome,perfil:PERFIS[ME().perfil],acao});db.log=db.log.slice(0,500);save()}",
 "function log(acao){const u=ME();db.log.unshift({q:new Date().toISOString(),u:u.nome,perfil:PERFIS[u.perfil]||'',acao});db.log=db.log.slice(0,300);window.SYNC.log(u.nome,PERFIS[u.perfil]||'',acao)}")
m = rep(m, "if(!db.estoque){seedFeat();save()}", "if(!db.online||db.__novo){const est=db.estoque,mv=db.mov,pk=db.pacotes;seedFeat();if(db.__novo){db.estoque=[];db.mov=[];db.pacotes=[];db.procs.forEach(p=>p.insumos=[])}else{db.estoque=est;db.mov=mv;db.pacotes=pk}}")
m = rep(m, """<button class="link" onclick="trocarUsuario()">Trocar</button>`}""", """<button class="link" onclick="trocarUsuario()">Sair</button>`}""")
m = re.sub(r"window\.trocarUsuario=\(\)=>\{modal\('Entrar como'.*?\n(.*?\n)*?.*?toast\('Olá, '\+c\.nome\.split\(' '\)\[0\]\)\}\};\n",
 "window.trocarUsuario=()=>{modal('Sair do sistema',`<div class=\"detail\"><p>Sair do sistema neste aparelho? Para entrar de novo será preciso o e-mail e a senha.</p><div class=\"toolbar\" style=\"margin:0\"><button class=\"btn ghost\" onclick=\"dlg.close()\">Cancelar</button><button class=\"btn\" onclick=\"log('Saiu do sistema');setTimeout(sairSistema,300)\">Sair</button></div></div>`)};\n", m, count=1)
assert "Entrar como" not in m
m = rep(m, """<p class="hint">Confirme seu PIN para abrir a administração. O acesso fica registrado.</p>""", """<p class="hint">Confirme sua senha para abrir a administração. O acesso fica registrado.</p>""")
m = rep(m, """onsubmit="event.preventDefault();if($('#adm-pin').value===ME().pin){adminOk=true;log('Abriu a área de administração');render()}else{toast('PIN incorreto');$('#adm-pin').value=''}"><input id="adm-pin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN" autocomplete="off" style="max-width:160px">""",
 """onsubmit="event.preventDefault();confirmaSenha($('#adm-pin').value).then(ok=>{if(ok){adminOk=true;log('Abriu a área de administração');render()}else{toast('Senha incorreta');$('#adm-pin').value=''}})"><input id="adm-pin" type="password" placeholder="Sua senha" autocomplete="current-password" style="max-width:220px">""")
m = rep(m, """${I(c,'pin','PIN de acesso (4 a 6 números)','type="password" inputmode="numeric" pattern="[0-9]{4,6}" required autocomplete="new-password"')}""",
 """<input type="hidden" id="x-pin" value=""><p class="full hint" style="margin:0">A pessoa entra no sistema com o e-mail acima. No primeiro acesso ela clica em "Primeiro acesso" e cria a própria senha.</p>""")
m = rep(m, "window.claude?.use?await window.claude.use('downloads'):null", "window.DL", 0)
m = re.sub(r"Link para divulgar: <b>clinicabezerra\.com\.br/agendar</b> \([^)]*\)", "Link para divulgar: <b>${location.origin}/agendar.html</b>", m, count=1)
m = rep(m, "userBox();render();", "userBox();render();if(db.__novo){delete db.__novo;save();setTimeout(()=>{toast('Sistema criado. Cadastre a equipe em Administração');go('admin')},400)}")

# ---------- marcação ----------
b = body
b = rep(b, '<div class="app">', '<div class="app" hidden>')
b = re.sub(r'<div class="demo-note">.*?</div>', '<div class="demo-note"><span id="sync">Conectando…</span><br><button id="instalar" hidden onclick="instalarApp()">Instalar aplicativo</button></div>', b, count=1, flags=re.S)

auth = """<div id="carregando" class="au"><div class="au-card"><p>Carregando…</p></div></div>
<div id="auth" class="au" hidden><form id="au-form" class="au-card">
  <div class="au-brand"><b>Clínica Bezerra</b><span>Estética avançada</span></div>
  <h1 id="au-t">Entrar</h1>
  <label id="au-mail-w">E-mail<input id="au-mail" type="email" autocomplete="username" required></label>
  <label id="au-pass-w">Senha<input id="au-pass" type="password" autocomplete="current-password" minlength="6"></label>
  <button class="btn" id="au-btn">Entrar</button>
  <p id="au-msg" class="au-msg" role="status"></p>
  <div id="au-links" class="au-links"><button type="button" class="link" onclick="trocaModo('criar')">Primeiro acesso</button><button type="button" class="link" onclick="trocaModo('esqueci')">Esqueci a senha</button><button type="button" class="link" onclick="trocaModo('entrar')">Entrar</button></div>
</form></div>
"""
css_extra = """
.au{min-height:100vh;display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-left,0px))}
.au-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:28px;width:min(400px,100%);display:flex;flex-direction:column;gap:14px}
.au-card h1{font-size:22px}.au-card label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:500;color:var(--muted)}
.au-brand b{font-family:var(--f-display);font-size:22px;display:block}.au-brand span{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--gold)}
.au-msg{margin:0;font-size:13px;color:var(--muted)}.au-msg.err{color:var(--bad)}
.au-links{display:flex;gap:16px;flex-wrap:wrap;font-size:13px}
#sync{font-weight:600}#sync.err{color:var(--bad)}
#instalar{margin-top:6px}
"""
cfg = open(os.path.join(AQUI, 'config.js'), encoding='utf-8').read() if os.path.exists(os.path.join(AQUI, 'config.js')) else "window.CB_CONFIG={url:'',key:''};"
html = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Clínica Bezerra</title>
<meta name="theme-color" content="#1f6f62">
<script>try{{var t=localStorage.getItem("cb-tema")||"classico";document.documentElement.dataset.tema=t;document.documentElement.dataset.theme=t==="noite"?"dark":"light"}}catch(e){{}}</script>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="supabase.js"></script>
<script src="config.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Playfair+Display:wght@500;600&family=Cormorant+Garamond:wght@500;600&display=swap">
<style>
:root{{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}
body{{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}}img{{max-width:100%}}[hidden]{{display:none!important}}
{style}{css_extra}</style></head><body>
{auth}{b}<script type="text/plain" id="app-src">
{m}</script>
<script>
{loader}</script>
</body></html>
"""
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)
open(os.path.join(OUT, 'config.js'), 'w', encoding='utf-8').write(cfg)
for f in ['supabase.js', '591.supabase.js', 'agendar.html', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']:
    s = os.path.join(AQUI, 'static', f)
    if os.path.exists(s): shutil.copy(s, os.path.join(OUT, f))
print('ok', len(html))
