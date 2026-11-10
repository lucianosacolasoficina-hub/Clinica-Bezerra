// Cora · serviço de pedidos de mudança no sistema.
// Só a administradora (perfil "admin" ativo) pode usar. Guarda a chave do GitHub no servidor
// e apenas abre pedidos, pede publicação, desfaz ou descarta. Quem altera o código é a automação
// do GitHub, que testa tudo e publica primeiro num site de teste.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resp = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });
const REPO = Deno.env.get("CORA_REPO") ?? "lucianosacolasoficina-hub/Clinica-Bezerra";
const GH = Deno.env.get("CORA_GITHUB_TOKEN") ?? "";
const SITE_TESTE = Deno.env.get("CORA_SITE_TESTE") ?? "https://clinica-bezerra-teste.onrender.com";

async function gh(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${GH}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "cora-clinica", ...(init.headers ?? {}) },
  });
  if (!r.ok && r.status !== 204) throw new Error(`GitHub respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}
const ESTADOS = ["cora:descartado", "cora:desfeito", "cora:publicado", "cora:erro", "cora:sem-mudanca", "cora:pronto", "cora:andamento"];
const estado = (labels: { name: string }[]) => {
  const n = labels.map((l) => l.name);
  return (ESTADOS.find((e) => n.includes(e)) ?? "cora:fila").replace("cora:", "");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return resp("ok");
  try {
    const auth = req.headers.get("authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { authorization: auth } } });
    const { data: eu, error } = await sb.rpc("meu_colab");
    if (error || !eu || eu.perfil !== "admin") return resp({ erro: "Só a administradora pode pedir mudanças no sistema." }, 403);
    if (!GH) return resp({ erro: "A Cora ainda não foi ligada ao GitHub. Falta cadastrar a chave CORA_GITHUB_TOKEN no Supabase." }, 503);

    const b = await req.json().catch(() => ({}));
    const n = Number(b.n);
    switch (b.acao) {
      case "listar": {
        const issues = await gh(`/issues?labels=cora&state=all&per_page=15&sort=created&direction=desc`);
        const lista = await Promise.all(issues.map(async (i: any) => {
          const com = i.comments ? await gh(`/issues/${i.number}/comments?per_page=100`) : [];
          return { n: i.number, titulo: i.title, estado: estado(i.labels), criado: i.created_at, por: (i.body ?? "").match(/Pedido por: (.*)$/m)?.[1] ?? "", ultimo: com.length ? com[com.length - 1].body : "" };
        }));
        return resp({ ok: true, pedidos: lista, site_teste: SITE_TESTE });
      }
      case "pedir": {
        const texto = String(b.texto ?? "").trim();
        if (texto.length < 8) return resp({ erro: "Descreva a mudança com um pouco mais de detalhe." }, 400);
        if (texto.length > 4000) return resp({ erro: "Pedido muito longo. Divida em partes menores." }, 400);
        const abertos = await gh(`/issues?labels=cora:andamento&state=open&per_page=5`);
        if (abertos.length >= 3) return resp({ erro: "Já há pedidos em andamento. Aguarde terminarem." }, 429);
        const titulo = texto.split("\n")[0].slice(0, 70);
        const i = await gh(`/issues`, { method: "POST", body: JSON.stringify({ title: titulo, labels: ["cora"], body: `${texto}\n\n---\nPedido por: ${eu.nome} (${eu.email})` }) });
        return resp({ ok: true, n: i.number });
      }
      case "publicar":
      case "desfazer": {
        if (!Number.isInteger(n) || n < 1) return resp({ erro: "Pedido inválido." }, 400);
        await gh(`/actions/workflows/cora-${b.acao}.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { issue: String(n) } }) });
        return resp({ ok: true });
      }
      case "descartar": {
        if (!Number.isInteger(n) || n < 1) return resp({ erro: "Pedido inválido." }, 400);
        await gh(`/issues/${n}/labels`, { method: "POST", body: JSON.stringify({ labels: ["cora:descartado"] }) });
        await gh(`/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body: `Descartado por ${eu.nome}.` }) });
        await gh(`/issues/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
        return resp({ ok: true });
      }
      default:
        return resp({ erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    return resp({ erro: String((e as Error).message ?? e) }, 500);
  }
});
