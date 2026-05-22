create extension if not exists pgcrypto;

alter table public.empresas
  add column if not exists documento_tipo text default 'CNPJ',
  add column if not exists registro_inpi text,
  add column if not exists certificado_programa_inpi_url text,
  add column if not exists responsavel_legal_nome text,
  add column if not exists responsavel_legal_cpf text,
  add column if not exists responsavel_tecnico_nome text,
  add column if not exists responsavel_tecnico_cpf text,
  add column if not exists politica_biometria_url text,
  add column if not exists permitir_offline boolean not null default false,
  add column if not exists mfa_admin_obrigatorio boolean not null default true;

alter table public.funcionarios
  add column if not exists consentimento_biometria_em timestamptz,
  add column if not exists consentimento_biometria_ip text,
  add column if not exists consentimento_biometria_user_agent text,
  add column if not exists consentimento_biometria_versao text;

create table if not exists public.rep_p_configuracoes (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  marca_programa text not null default 'PontoFácil',
  identificador_programa text not null default 'pontofacil-rep-p',
  versao_programa text not null default '2026.05',
  numero_registro_inpi text,
  certificado_inpi_url text,
  certificado_icp_brasil_alias text,
  afd_assinatura_p7s_obrigatoria boolean not null default true,
  variacao_hlb_max_segundos integer not null default 30,
  offline_permitido boolean not null default false,
  retention_anos integer not null default 5,
  lgpd_biometria_versao text not null default '2026.05',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rep_p_dispositivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  funcionario_id uuid references public.funcionarios(id) on delete cascade,
  user_id uuid,
  device_fingerprint text not null,
  nome_dispositivo text,
  plataforma text,
  user_agent text,
  confiavel boolean not null default false,
  bloqueado boolean not null default false,
  primeiro_acesso_em timestamptz not null default now(),
  ultimo_acesso_em timestamptz not null default now(),
  unique (empresa_id, device_fingerprint)
);

create table if not exists public.rep_p_marcacoes_offline (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  funcionario_id uuid references public.funcionarios(id) on delete cascade,
  user_id uuid,
  registro_cliente_id text not null,
  payload jsonb not null,
  hash_cliente_sha256 text not null,
  coletado_em_cliente timestamptz not null,
  sincronizado_em timestamptz,
  registro_ponto_id uuid references public.registros_ponto(id) on delete set null,
  status text not null default 'pendente',
  motivo_rejeicao text,
  created_at timestamptz not null default now(),
  unique (empresa_id, registro_cliente_id)
);

create table if not exists public.rep_p_sincronismo_hlb (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'edge-function',
  data_hora_servidor timestamptz not null default now(),
  referencia_hlb timestamptz,
  drift_segundos numeric,
  status text not null default 'nao_verificado',
  detalhe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.rep_p_exportacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid,
  tipo text not null,
  filename text not null,
  inicio timestamptz not null,
  fim timestamptz not null,
  hash_arquivo text not null,
  assinatura_p7s_url text,
  qtd_registros integer not null default 0,
  emitido_em timestamptz not null default now(),
  status text not null default 'gerado',
  observacao text
);

create table if not exists public.rep_p_releases (
  id uuid primary key default gen_random_uuid(),
  versao text not null unique,
  hash_pacote text,
  changelog text,
  publicado_em timestamptz not null default now(),
  responsavel text,
  evidencia_url text
);

alter table public.rep_p_configuracoes enable row level security;
alter table public.rep_p_dispositivos enable row level security;
alter table public.rep_p_marcacoes_offline enable row level security;
alter table public.rep_p_sincronismo_hlb enable row level security;
alter table public.rep_p_exportacoes enable row level security;
alter table public.rep_p_releases enable row level security;

drop policy if exists "rep_p_configuracoes_select_empresa" on public.rep_p_configuracoes;
create policy "rep_p_configuracoes_select_empresa"
on public.rep_p_configuracoes
for select
to authenticated
using (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.user_id = auth.uid()
      and ue.empresa_id = rep_p_configuracoes.empresa_id
      and ue.ativo = true
  )
);

drop policy if exists "rep_p_dispositivos_select_empresa" on public.rep_p_dispositivos;
create policy "rep_p_dispositivos_select_empresa"
on public.rep_p_dispositivos
for select
to authenticated
using (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.user_id = auth.uid()
      and ue.empresa_id = rep_p_dispositivos.empresa_id
      and ue.ativo = true
  )
);

drop policy if exists "rep_p_exportacoes_select_empresa" on public.rep_p_exportacoes;
create policy "rep_p_exportacoes_select_empresa"
on public.rep_p_exportacoes
for select
to authenticated
using (
  exists (
    select 1 from public.usuarios_empresas ue
    where ue.user_id = auth.uid()
      and ue.empresa_id = rep_p_exportacoes.empresa_id
      and ue.ativo = true
      and coalesce(ue.perfil_admin, ue.perfil) in ('gestor','admin','super_admin','rh','auditor','supervisor')
  )
);

drop policy if exists "rep_p_releases_select_auth" on public.rep_p_releases;
create policy "rep_p_releases_select_auth"
on public.rep_p_releases
for select
to authenticated
using (true);

create or replace function public.rep_p_dashboard_confiabilidade(p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if not exists (
    select 1 from public.usuarios_empresas ue
    where ue.user_id = v_user_id
      and ue.empresa_id = p_empresa_id
      and ue.ativo = true
      and coalesce(ue.perfil_admin, ue.perfil) in ('gestor','admin','super_admin','rh','auditor','supervisor')
  ) then
    raise exception 'Sem permissão para consultar confiabilidade REP-P.';
  end if;

  select jsonb_build_object(
    'empresa_id', p_empresa_id,
    'marcacoes_total', (
      select count(*) from public.registros_ponto r where r.empresa_id = p_empresa_id
    ),
    'marcacoes_sem_nsr', (
      select count(*) from public.registros_ponto r where r.empresa_id = p_empresa_id and r.nsr is null
    ),
    'marcacoes_sem_hash', (
      select count(*) from public.registros_ponto r where r.empresa_id = p_empresa_id and nullif(r.hash_registro, '') is null
    ),
    'dispositivos_confiaveis', (
      select count(*) from public.rep_p_dispositivos d where d.empresa_id = p_empresa_id and d.confiavel = true
    ),
    'dispositivos_bloqueados', (
      select count(*) from public.rep_p_dispositivos d where d.empresa_id = p_empresa_id and d.bloqueado = true
    ),
    'offline_pendente', (
      select count(*) from public.rep_p_marcacoes_offline o where o.empresa_id = p_empresa_id and o.status = 'pendente'
    ),
    'exportacoes_30d', (
      select count(*) from public.rep_p_exportacoes e where e.empresa_id = p_empresa_id and e.emitido_em >= now() - interval '30 days'
    ),
    'ultima_exportacao', (
      select max(e.emitido_em) from public.rep_p_exportacoes e where e.empresa_id = p_empresa_id
    ),
    'ultimo_nsr', (
      select c.ultimo_nsr from public.rep_p_nsr_contadores c where c.empresa_id = p_empresa_id
    )
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.rep_p_dashboard_confiabilidade(uuid) to authenticated;
