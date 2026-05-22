create extension if not exists pgcrypto;

alter table public.registros_ponto
  add column if not exists nsr bigint,
  add column if not exists data_hora_servidor timestamptz,
  add column if not exists timezone text default 'America/Sao_Paulo',
  add column if not exists hash_registro text,
  add column if not exists assinatura_servidor text,
  add column if not exists device_info jsonb default '{}'::jsonb,
  add column if not exists created_by uuid,
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por uuid,
  add column if not exists motivo_cancelamento text;

create table if not exists public.rep_p_nsr_contadores (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ultimo_nsr bigint not null default 0,
  updated_at timestamptz not null default now()
);

create unique index if not exists registros_ponto_empresa_nsr_uidx
  on public.registros_ponto(empresa_id, nsr)
  where nsr is not null;

create table if not exists public.rep_p_auditoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas(id) on delete cascade,
  funcionario_id uuid references public.funcionarios(id) on delete set null,
  user_id uuid,
  acao text not null,
  detalhe jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.registros_ponto enable row level security;
alter table public.rep_p_auditoria enable row level security;
alter table public.rep_p_nsr_contadores enable row level security;

drop policy if exists "registros_ponto_select_empresa" on public.registros_ponto;
create policy "registros_ponto_select_empresa"
on public.registros_ponto
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.user_id = auth.uid()
      and ue.empresa_id = registros_ponto.empresa_id
      and ue.ativo = true
  )
);

drop policy if exists "rep_p_auditoria_select_empresa" on public.rep_p_auditoria;
create policy "rep_p_auditoria_select_empresa"
on public.rep_p_auditoria
for select
to authenticated
using (
  exists (
    select 1
    from public.usuarios_empresas ue
    where ue.user_id = auth.uid()
      and ue.empresa_id = rep_p_auditoria.empresa_id
      and ue.ativo = true
      and coalesce(ue.perfil_admin, ue.perfil) in ('gestor','admin','super_admin','rh','auditor','supervisor')
  )
);

drop policy if exists "rep_p_nsr_contadores_sem_select_cliente" on public.rep_p_nsr_contadores;
create policy "rep_p_nsr_contadores_sem_select_cliente"
on public.rep_p_nsr_contadores
for select
to authenticated
using (false);

create or replace function public.proteger_registros_ponto_write()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.registrar_ponto_rep_p', true) <> 'on' then
    raise exception 'Escrita direta em registros_ponto bloqueada. Use a rotina REP-P oficial.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_proteger_registros_ponto_write on public.registros_ponto;
create trigger trg_proteger_registros_ponto_write
before insert or update or delete on public.registros_ponto
for each row execute function public.proteger_registros_ponto_write();

create or replace function public.registrar_ponto_rep_p(
  p_empresa_id uuid,
  p_tipo text,
  p_observacao text default null,
  p_foto_url text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_precisao_gps double precision default null,
  p_distancia_metros integer default null,
  p_captura_ao_vivo boolean default true,
  p_metodo_captura text default 'camera',
  p_score_fraude integer default 0,
  p_nivel_fraude text default 'baixo',
  p_device_info jsonb default '{}'::jsonb
)
returns public.registros_ponto
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_funcionario public.funcionarios%rowtype;
  v_vinculo record;
  v_empresa public.empresas%rowtype;
  v_tipos_hoje text[];
  v_proximo_tipo text;
  v_nsr bigint;
  v_data_hora timestamptz := clock_timestamp();
  v_payload jsonb;
  v_hash text;
  v_registro public.registros_ponto%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sessão inválida.';
  end if;

  if p_tipo not in ('entrada','saida_intervalo','retorno_intervalo','saida') then
    raise exception 'Tipo de registro inválido.';
  end if;

  select *
    into v_empresa
  from public.empresas
  where id = p_empresa_id
    and ativa = true;

  if not found then
    raise exception 'Empresa não encontrada ou inativa.';
  end if;

  select *
    into v_funcionario
  from public.funcionarios
  where auth_user_id = v_user_id
    and empresa_id = p_empresa_id
    and ativo = true;

  if not found then
    raise exception 'Funcionário não encontrado, inativo ou fora da empresa.';
  end if;

  select *
    into v_vinculo
  from public.usuarios_empresas
  where user_id = v_user_id
    and empresa_id = p_empresa_id
    and perfil = 'funcionario'
    and ativo = true
  limit 1;

  if not found then
    raise exception 'Vínculo de funcionário inválido.';
  end if;

  select coalesce(array_agg(r.tipo order by r.data_hora), array[]::text[])
    into v_tipos_hoje
  from public.registros_ponto r
  where r.empresa_id = p_empresa_id
    and r.funcionario_id = v_funcionario.id
    and (r.data_hora at time zone 'America/Sao_Paulo')::date =
        (v_data_hora at time zone 'America/Sao_Paulo')::date
    and r.cancelado_em is null;

  if v_funcionario.sem_intervalo = true then
    if not ('entrada' = any(v_tipos_hoje)) then
      v_proximo_tipo := 'entrada';
    elsif not ('saida' = any(v_tipos_hoje)) then
      v_proximo_tipo := 'saida';
    else
      raise exception 'Ponto de hoje já finalizado.';
    end if;
  else
    if not ('entrada' = any(v_tipos_hoje)) then
      v_proximo_tipo := 'entrada';
    elsif not ('saida_intervalo' = any(v_tipos_hoje)) then
      v_proximo_tipo := 'saida_intervalo';
    elsif not ('retorno_intervalo' = any(v_tipos_hoje)) then
      v_proximo_tipo := 'retorno_intervalo';
    elsif not ('saida' = any(v_tipos_hoje)) then
      v_proximo_tipo := 'saida';
    else
      raise exception 'Ponto de hoje já finalizado.';
    end if;
  end if;

  if p_tipo <> v_proximo_tipo then
    raise exception 'Sequência inválida. Próximo registro permitido: %.', v_proximo_tipo;
  end if;

  if exists (
    select 1
    from public.registros_ponto r
    where r.empresa_id = p_empresa_id
      and r.funcionario_id = v_funcionario.id
      and r.data_hora > v_data_hora - interval '5 minutes'
      and r.cancelado_em is null
  ) then
    raise exception 'Aguarde 5 minutos para registrar novamente.';
  end if;

  insert into public.rep_p_nsr_contadores(empresa_id, ultimo_nsr)
  values (p_empresa_id, 0)
  on conflict (empresa_id) do nothing;

  select ultimo_nsr + 1
    into v_nsr
  from public.rep_p_nsr_contadores
  where empresa_id = p_empresa_id
  for update;

  update public.rep_p_nsr_contadores
    set ultimo_nsr = v_nsr,
        updated_at = v_data_hora
  where empresa_id = p_empresa_id;

  v_payload := jsonb_build_object(
    'empresa_id', p_empresa_id,
    'funcionario_id', v_funcionario.id,
    'auth_user_id', v_user_id,
    'tipo', p_tipo,
    'nsr', v_nsr,
    'data_hora_servidor', v_data_hora,
    'timezone', 'America/Sao_Paulo',
    'foto_url', coalesce(p_foto_url, ''),
    'latitude', p_latitude,
    'longitude', p_longitude,
    'precisao_gps', p_precisao_gps,
    'distancia_metros', p_distancia_metros,
    'captura_ao_vivo', p_captura_ao_vivo,
    'metodo_captura', p_metodo_captura,
    'score_fraude', p_score_fraude,
    'nivel_fraude', p_nivel_fraude,
    'device_info', coalesce(p_device_info, '{}'::jsonb)
  );

  v_hash := encode(digest(v_payload::text, 'sha256'), 'hex');

  perform set_config('app.registrar_ponto_rep_p', 'on', true);

  insert into public.registros_ponto(
    empresa_id,
    funcionario_id,
    tipo,
    observacao,
    data_hora,
    data_hora_servidor,
    timezone,
    foto_url,
    latitude,
    longitude,
    precisao_gps,
    distancia_metros,
    captura_ao_vivo,
    metodo_captura,
    score_fraude,
    nivel_fraude,
    device_info,
    nsr,
    hash_registro,
    assinatura_servidor,
    created_by
  )
  values (
    p_empresa_id,
    v_funcionario.id,
    p_tipo,
    nullif(trim(coalesce(p_observacao, '')), ''),
    v_data_hora,
    v_data_hora,
    'America/Sao_Paulo',
    p_foto_url,
    p_latitude,
    p_longitude,
    p_precisao_gps,
    p_distancia_metros,
    p_captura_ao_vivo,
    p_metodo_captura,
    p_score_fraude,
    p_nivel_fraude,
    coalesce(p_device_info, '{}'::jsonb),
    v_nsr,
    v_hash,
    v_hash,
    v_user_id
  )
  returning * into v_registro;

  insert into public.rep_p_auditoria(
    empresa_id,
    funcionario_id,
    user_id,
    acao,
    detalhe,
    user_agent
  )
  values (
    p_empresa_id,
    v_funcionario.id,
    v_user_id,
    'registrar_ponto',
    jsonb_build_object(
      'registro_id', v_registro.id,
      'tipo', p_tipo,
      'nsr', v_nsr,
      'hash_registro', v_hash,
      'score_fraude', p_score_fraude,
      'nivel_fraude', p_nivel_fraude
    ),
    p_device_info->>'user_agent'
  );

  return v_registro;
end;
$$;

grant execute on function public.registrar_ponto_rep_p(
  uuid,
  text,
  text,
  text,
  double precision,
  double precision,
  double precision,
  integer,
  boolean,
  text,
  integer,
  text,
  jsonb
) to authenticated;
