-- Clínica Bezerra · estrutura do banco (Supabase / Postgres)
-- Cada registro do sistema (paciente, agendamento, evolução...) é uma linha em "registros",
-- separada por "colecao". Configurações ficam em colecao = 'config'.

create table if not exists public.registros (
  colecao        text        not null,
  id             text        not null,
  dados          jsonb       not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid                 default auth.uid(),
  primary key (colecao, id)
);
create index if not exists registros_colecao_idx on public.registros (colecao);

-- Registro de acessos (somente inclusão, ninguém altera nem apaga)
create table if not exists public.acessos (
  id      bigserial   primary key,
  quando  timestamptz not null default now(),
  usuario uuid        not null default auth.uid(),
  email   text        not null default (auth.jwt() ->> 'email'),
  nome    text,
  perfil  text,
  acao    text        not null
);

-- ---------- funções de apoio (rodam com privilégio do dono, sem expor dados) ----------
create or replace function public.meu_colab() returns jsonb
language sql stable security definer set search_path = public as $$
  select dados from registros
  where colecao = 'colab'
    and lower(dados->>'email') = lower(auth.jwt()->>'email')
    and coalesce((dados->>'ativo')::boolean, false)
  limit 1
$$;

create or replace function public.usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.meu_colab() is not null
$$;

create or replace function public.nivel(modulo text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.meu_colab() is null then 'nenhum'
    when public.meu_colab()->>'perfil' = 'admin' then 'editar'
    else coalesce((select dados -> (public.meu_colab()->>'perfil') ->> modulo
                   from registros where colecao = 'config' and id = 'perms'), 'nenhum')
  end
$$;

create or replace function public.sistema_vazio() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from registros where colecao = 'colab')
$$;

-- ---------- segurança por linha ----------
alter table public.registros enable row level security;
alter table public.acessos  enable row level security;

drop policy if exists ler on public.registros;
create policy ler on public.registros for select to authenticated using (
  case
    when colecao in ('evol','termos') then public.nivel('prontuario') <> 'nenhum'
    else public.usuario_ativo()
  end
);

drop policy if exists incluir on public.registros;
create policy incluir on public.registros for insert to authenticated with check (
  case
    when colecao in ('evol','termos') then public.nivel('prontuario') = 'editar'
    when colecao = 'colab' then public.nivel('admin') = 'editar'
         or (public.sistema_vazio() and dados->>'perfil' = 'admin'
             and lower(dados->>'email') = lower(auth.jwt()->>'email'))
    when colecao = 'config' then public.nivel('admin') = 'editar'
         or public.sistema_vazio()
         or (id in ('online','fidel') and public.nivel('marketing') = 'editar')
    else public.usuario_ativo()
  end
);

drop policy if exists alterar on public.registros;
create policy alterar on public.registros for update to authenticated using (
  case
    when colecao in ('evol','termos') then public.nivel('prontuario') = 'editar'
    when colecao = 'colab' then public.nivel('admin') = 'editar'
    when colecao = 'config' then public.nivel('admin') = 'editar'
         or (id in ('online','fidel') and public.nivel('marketing') = 'editar')
    else public.usuario_ativo()
  end
) with check (
  case
    -- evolução assinada não pode voltar a rascunho
    when colecao = 'evol' then public.nivel('prontuario') = 'editar'
    when colecao = 'colab' then public.nivel('admin') = 'editar'
    when colecao = 'config' then public.nivel('admin') = 'editar'
         or (id in ('online','fidel') and public.nivel('marketing') = 'editar')
    else public.usuario_ativo()
  end
);

drop policy if exists apagar on public.registros;
create policy apagar on public.registros for delete to authenticated using (
  colecao not in ('evol','termos','colab','config') and public.usuario_ativo()
);

-- Evolução assinada fica travada: só aceita novos adendos
create or replace function public.trava_evolucao() returns trigger
language plpgsql as $$
begin
  if old.dados->>'status' = 'assinada' then
    if (new.dados - 'adendos') is distinct from (old.dados - 'adendos')
       or jsonb_array_length(coalesce(new.dados->'adendos','[]')) < jsonb_array_length(coalesce(old.dados->'adendos','[]')) then
      raise exception 'Evolução assinada não pode ser alterada. Registre um adendo.';
    end if;
  end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists trava_evolucao on public.registros;
create trigger trava_evolucao before update on public.registros
  for each row when (old.colecao = 'evol') execute function public.trava_evolucao();

create or replace function public.carimbo() returns trigger
language plpgsql as $$
begin new.atualizado_em := now(); new.atualizado_por := auth.uid(); return new; end $$;
drop trigger if exists carimbo on public.registros;
create trigger carimbo before update on public.registros
  for each row when (old.colecao <> 'evol') execute function public.carimbo();

drop policy if exists acessos_incluir on public.acessos;
create policy acessos_incluir on public.acessos for insert to authenticated
  with check (usuario = auth.uid() and (public.usuario_ativo() or public.sistema_vazio()));
drop policy if exists acessos_ler on public.acessos;
create policy acessos_ler on public.acessos for select to authenticated
  using (public.nivel('admin') = 'editar');

-- Atualização ao vivo entre computadores
do $$ begin
  alter publication supabase_realtime add table public.registros;
exception when duplicate_object then null; end $$;

-- ---------- agendamento online (página pública) ----------
create or replace function public.agenda_publica() returns jsonb
language sql stable security definer set search_path = public as $$
  with cfg as (select dados from registros where colecao = 'config' and id = 'online'),
       cli as (select dados from registros where colecao = 'config' and id = 'clinica')
  select jsonb_build_object(
    'clinica', (select dados->>'nome' from cli),
    'ativo',   coalesce((select (dados->>'ativo')::boolean from cfg), false),
    'inicio',  (select dados->>'inicio' from cfg),
    'fim',     (select dados->>'fim' from cfg),
    'passo',   (select (dados->>'passo')::int from cfg),
    'procs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'nome', r.dados->>'nome',
                 'dur', (r.dados->>'dur')::int, 'preco', (r.dados->>'preco')::numeric) order by r.dados->>'nome')
              from registros r, cfg
              where r.colecao = 'procs' and cfg.dados->'procs' ? r.id), '[]'::jsonb),
    'profs', coalesce((select jsonb_agg(coalesce(nullif(dados->>'exib',''), dados->>'nome'))
              from registros where colecao = 'colab'
                and coalesce((dados->>'ativo')::boolean,false) and coalesce((dados->>'atende')::boolean,false)), '[]'::jsonb),
    'ocupados', coalesce((select jsonb_agg(jsonb_build_object('data', a.dados->>'data', 'hora', a.dados->>'hora',
                 'prof', a.dados->>'prof', 'dur', coalesce((p.dados->>'dur')::int, 30)))
              from registros a left join registros p on p.colecao = 'procs' and p.id = a.dados->>'proc'
              where a.colecao = 'ag' and a.dados->>'status' <> 'cancelado'
                and (a.dados->>'data')::date between current_date and current_date + 31), '[]'::jsonb)
  )
$$;

create or replace function public.agendar_online(p_nome text, p_tel text, p_proc text, p_prof text, p_data date, p_hora text)
returns text language plpgsql security definer set search_path = public as $$
declare cfg jsonb; dur int; ini int; tel text; pac text; ag text; ocupado boolean;
begin
  select dados into cfg from registros where colecao = 'config' and id = 'online';
  if cfg is null or not coalesce((cfg->>'ativo')::boolean, false) then raise exception 'Agendamento online desligado'; end if;
  if not (cfg->'procs' ? p_proc) then raise exception 'Procedimento indisponível'; end if;
  if length(trim(coalesce(p_nome,''))) < 3 or length(trim(p_nome)) > 120 then raise exception 'Informe o nome completo'; end if;
  tel := regexp_replace(coalesce(p_tel,''), '\D', '', 'g');
  if length(tel) < 10 or length(tel) > 13 then raise exception 'Telefone inválido'; end if;
  if p_data < current_date or p_data > current_date + 31 or extract(dow from p_data) = 0 then raise exception 'Data indisponível'; end if;
  if p_hora !~ '^\d{2}:\d{2}$' then raise exception 'Horário inválido'; end if;
  if not exists (select 1 from registros where colecao = 'colab' and coalesce(nullif(dados->>'exib',''), dados->>'nome') = p_prof
                 and coalesce((dados->>'atende')::boolean,false) and coalesce((dados->>'ativo')::boolean,false)) then
    raise exception 'Profissional indisponível'; end if;
  select coalesce((dados->>'dur')::int, 30) into dur from registros where colecao = 'procs' and id = p_proc;
  ini := split_part(p_hora, ':', 1)::int * 60 + split_part(p_hora, ':', 2)::int;
  if ini < split_part(cfg->>'inicio', ':', 1)::int * 60 + split_part(cfg->>'inicio', ':', 2)::int
     or ini + dur > split_part(cfg->>'fim', ':', 1)::int * 60 + split_part(cfg->>'fim', ':', 2)::int then
    raise exception 'Fora do horário de atendimento'; end if;
  perform pg_advisory_xact_lock(hashtext(p_prof || p_data::text));
  select exists (
    select 1 from registros a left join registros p on p.colecao = 'procs' and p.id = a.dados->>'proc'
    where a.colecao = 'ag' and a.dados->>'status' <> 'cancelado' and a.dados->>'prof' = p_prof and a.dados->>'data' = p_data::text
      and ini < split_part(a.dados->>'hora', ':', 1)::int * 60 + split_part(a.dados->>'hora', ':', 2)::int + coalesce((p.dados->>'dur')::int, 30)
      and ini + dur > split_part(a.dados->>'hora', ':', 1)::int * 60 + split_part(a.dados->>'hora', ':', 2)::int
  ) into ocupado;
  if ocupado then raise exception 'Esse horário acabou de ser ocupado'; end if;
  select id into pac from registros where colecao = 'pacientes' and regexp_replace(coalesce(dados->>'tel',''), '\D', '', 'g') = tel limit 1;
  if pac is null then
    pac := 'on' || substr(md5(random()::text), 1, 8);
    insert into registros (colecao, id, dados) values ('pacientes', pac, jsonb_build_object(
      'id', pac, 'nome', trim(p_nome), 'tel', p_tel, 'nasc', '', 'obs', '', 'desde', current_date::text, 'origem', 'online'));
  end if;
  ag := 'on' || substr(md5(random()::text), 1, 8);
  insert into registros (colecao, id, dados) values ('ag', ag, jsonb_build_object(
    'id', ag, 'data', p_data::text, 'hora', p_hora, 'pac', pac, 'proc', p_proc, 'prof', p_prof, 'status', 'agendado', 'origem', 'online'));
  return ag;
end $$;

revoke all on function public.agenda_publica() from public;
revoke all on function public.agendar_online(text,text,text,text,date,text) from public;
grant execute on function public.agenda_publica() to anon, authenticated;
grant execute on function public.agendar_online(text,text,text,text,date,text) to anon, authenticated;
revoke execute on function public.meu_colab(), public.usuario_ativo(), public.nivel(text), public.sistema_vazio() from public, anon;
grant execute on function public.meu_colab(), public.usuario_ativo(), public.nivel(text), public.sistema_vazio() to authenticated;
revoke all on table public.registros, public.acessos from anon;
