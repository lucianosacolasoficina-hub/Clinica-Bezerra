# Sistema da Clínica Bezerra · regras para a IA (Cora)

Você recebe pedidos de mudança da administradora da clínica, escritos em português, por meio da assistente Cora.
Responda e escreva textos visíveis sempre em português do Brasil.

## Onde mexer
- Toda a interface do sistema está em `prototipo/clinica-bezerra.html` (um único arquivo: CSS no `<style>`, telas no `<script>`).
- A página pública de agendamento online é `static/agendar.html`.
- Depois de editar, rode `python3 build.py`. Ele gera `public/` (o site publicado) a partir do protótipo.
  O `build.py` faz substituições de texto exatas no protótipo; se ele falhar com "não encontrei", você alterou um trecho que ele precisa. Desfaça essa parte e ache outro jeito.

## Proibido (a automação recusa a mudança se esses arquivos forem alterados)
- `supabase/` (regras de segurança do banco, trava do prontuário), `loader.js` (login e gravação), `config.js`, `build.py`, `.github/`, `CLAUDE.md`, `tests/`.
- Não remova nem enfraqueça: confirmação de senha da Administração, checagens de permissão (`can(...)`, `need(...)`), assinatura e trava das evoluções, registro de acessos.
- Não envie dados de pacientes para nenhum serviço externo novo. Não adicione scripts de domínios novos (só cdnjs.cloudflare.com e fonts.googleapis.com, que já existem).
- Não apague dados nem mude o formato dos registros existentes de forma que dados antigos deixem de abrir. Campos novos devem ser opcionais.

## Como trabalhar
- Faça a menor mudança que atende ao pedido e mantenha o visual coerente com os temas (Clássico, Rosé, Noite): use as variáveis CSS (`--accent`, `--surface` etc.), não cores fixas.
- Funciona no celular: confira larguras de 390px.
- Se o pedido for perigoso, ambíguo demais ou proibido acima, não altere nada e explique por quê no resumo.
- Ao final, escreva um resumo curto, em português simples, para a administradora: o que mudou e onde ver.
