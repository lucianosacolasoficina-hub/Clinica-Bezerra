# Clínica Bezerra · sistema online

Sistema de gestão da clínica (agenda, prontuário, financeiro, estoque, marketing) ligado a um banco Supabase, instalável no computador e no celular.

## Pastas
- `public/` — o site publicado (gerado pelo `build.py`; é o que o Render serve).
- `static/` — página pública de agendamento, ícones, manifesto e service worker.
- `supabase/schema.sql` — tabelas, regras de acesso por perfil e funções do agendamento online.
- `loader.js` — login, carga dos dados, gravação e atualização ao vivo.
- `build.py` — gera `public/index.html` a partir do protótipo `prototipo/clinica-bezerra.html`.
- `config.js` — endereço do projeto Supabase e chave pública (anon). A chave pública pode ficar no site: quem protege os dados são as regras do banco.

## Como funciona o acesso
1. A primeira pessoa que entra num banco vazio vira Administradora.
2. A administradora cadastra cada colaborador (Administração > Colaboradores) com o e-mail dele e o perfil.
3. A pessoa abre o sistema, clica em **Primeiro acesso** e cria a própria senha com aquele e-mail.
4. O banco só mostra dados para e-mails de colaboradores ativos. Prontuário e termos só para perfis com acesso ao prontuário. Evolução assinada não pode ser alterada (só adendo).

## Publicar de novo depois de mudanças
```
python3 build.py
git add -A && git commit -m "Atualiza sistema" && git push
```
O Render publica sozinho a cada push.
