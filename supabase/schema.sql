-- Agenda de Obrigações – estrutura do banco no Supabase
-- Cole tudo no Supabase > SQL Editor > New query e clique em Run.
-- Pode rodar de novo sem perder dados (só cria o que estiver faltando).

create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text not null,
  cnpj text default '',
  regime text not null default 'simples',
  obrigs text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.empresas add column if not exists segmento text default '';
alter table public.empresas add column if not exists ie text default '';
alter table public.empresas drop constraint if exists empresas_regime_check;

create table if not exists public.entregas (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  obrig text not null,
  comp text not null,              -- competência no formato AAAA-MM
  entregue_em date not null default current_date,
  primary key (empresa_id, obrig, comp)
);

create table if not exists public.config (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  whatsapp text default '',
  email text default '',
  dias_antes int not null default 3,
  ajustes jsonb not null default '{}'::jsonb,
  feriados jsonb not null default '[]'::jsonb,
  ultimo_envio date
);
alter table public.config add column if not exists gmail text default '';
alter table public.config add column if not exists senha_app text;
alter table public.config add column if not exists telegram_token text;
alter table public.config add column if not exists telegram_chat text;
alter table public.config add column if not exists telegram_bot text;
alter table public.config add column if not exists telegram_nome text;

-- Cada usuário só enxerga e altera os próprios dados.
alter table public.empresas enable row level security;
alter table public.entregas enable row level security;
alter table public.config   enable row level security;

drop policy if exists "dono empresas" on public.empresas;
create policy "dono empresas" on public.empresas
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "dono entregas" on public.entregas;
create policy "dono entregas" on public.entregas
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "dono config" on public.config;
create policy "dono config" on public.config
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
