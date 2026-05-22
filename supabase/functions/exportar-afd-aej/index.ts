import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

type ExportPayload = {
  tipo?: "afd" | "aej";
  inicio?: string;
  fim?: string;
  empresa_id?: string;
};

type RegistroPonto = {
  id: string;
  empresa_id: string;
  funcionario_id: string;
  tipo: string;
  nsr: number | null;
  data_hora: string;
  data_hora_servidor?: string | null;
  hash_registro?: string | null;
  funcionarios?: {
    nome_completo?: string | null;
    cpf?: string | null;
    pis?: string | null;
  } | null;
};

const REP_P = "REP_P";
const LAYOUT_VERSION = "001";

function onlyDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function cleanText(value: unknown, max = 150) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, max);
}

function pad(value: unknown, size: number, side: "left" | "right" = "right", fill = " ") {
  const text = String(value ?? "").slice(0, size);
  return side === "left" ? text.padStart(size, fill) : text.padEnd(size, fill);
}

function formatDh(dateValue: string) {
  const date = new Date(dateValue);
  const local = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(" ", "T");

  return `${local}:00-0300`;
}

function tipoMarcacao(tipo: string) {
  const mapa: Record<string, string> = {
    entrada: "1",
    saida_intervalo: "2",
    retorno_intervalo: "3",
    saida: "4",
  };

  return mapa[tipo] || "0";
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function criarLinhaAfdCabecalho(empresa: Record<string, unknown>, inicio: string, fim: string) {
  const documento = onlyDigits(empresa.cnpj || empresa.cpf).padStart(14, "0").slice(0, 14);
  const nome = cleanText(empresa.nome, 150);
  const inicioTxt = inicio.slice(0, 10);
  const fimTxt = fim.slice(0, 10);

  return [
    pad("000000000", 9, "left", "0"),
    "1",
    pad(documento, 14, "left", "0"),
    pad(nome, 150),
    pad(REP_P, 5),
    pad(inicioTxt, 10),
    pad(fimTxt, 10),
    pad(LAYOUT_VERSION, 3, "left", "0"),
  ].join("");
}

function criarLinhaAfdMarcacao(registro: RegistroPonto) {
  const funcionario = registro.funcionarios || {};
  const cpf = onlyDigits(funcionario.cpf || funcionario.pis).padStart(11, "0").slice(0, 11);
  const nsr = pad(registro.nsr || 0, 9, "left", "0");
  const dataHora = formatDh(registro.data_hora_servidor || registro.data_hora);
  const hash = pad(registro.hash_registro || "", 64);

  return [
    nsr,
    "3",
    dataHora,
    pad(cpf, 11, "left", "0"),
    tipoMarcacao(registro.tipo),
    hash,
  ].join("");
}

function criarLinhaAfdTrailer(qtdTipo3: number) {
  return [
    "999999999",
    pad(0, 9, "left", "0"),
    pad(qtdTipo3, 9, "left", "0"),
    pad(0, 9, "left", "0"),
    pad(0, 9, "left", "0"),
    pad(0, 9, "left", "0"),
    pad(0, 9, "left", "0"),
    "9",
  ].join("");
}

async function gerarAfd(empresa: Record<string, unknown>, registros: RegistroPonto[], inicio: string, fim: string) {
  const linhas = [
    criarLinhaAfdCabecalho(empresa, inicio, fim),
    ...registros.map(criarLinhaAfdMarcacao),
    criarLinhaAfdTrailer(registros.length),
    pad("ASSINATURA_DIGITAL_EM_ARQUIVO_P7S", 100),
  ];

  const conteudo = `${linhas.join("\r\n")}\r\n`;
  const hash = await sha256Hex(conteudo);

  return {
    conteudo,
    hash,
    observacao:
      "AFD gerado em texto com linha de assinatura externa P7S. Assine o arquivo com certificado ICP-Brasil do desenvolvedor/fabricante antes de entrega fiscal.",
  };
}

async function gerarAej(empresa: Record<string, unknown>, registros: RegistroPonto[], inicio: string, fim: string) {
  const linhas = [
    "TIPO;NSR;DATA_HORA;CPF;NOME;MARCACAO;HASH_REGISTRO",
    ...registros.map((registro) => {
      const funcionario = registro.funcionarios || {};
      return [
        "MARCACAO",
        registro.nsr || "",
        formatDh(registro.data_hora_servidor || registro.data_hora),
        onlyDigits(funcionario.cpf || funcionario.pis),
        `"${cleanText(funcionario.nome_completo, 120).replace(/"/g, "'")}"`,
        registro.tipo,
        registro.hash_registro || "",
      ].join(";");
    }),
  ];

  const conteudo = `${linhas.join("\r\n")}\r\n`;
  const hash = await sha256Hex(conteudo);

  return {
    conteudo,
    hash,
    observacao:
      "AEJ preliminar para conferencia operacional. Ajuste ao leiaute oficial completo do PTRP se o sistema tambem atuar como Programa de Tratamento.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") || "";

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: "Configuração Supabase ausente." }, 500);
  }

  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão ausente." }, 401);
  }

  let body: ExportPayload;

  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }

  const tipo = body.tipo === "aej" ? "aej" : "afd";
  const inicio = body.inicio;
  const fim = body.fim;

  if (!inicio || !fim) {
    return jsonResponse({ error: "Período obrigatório." }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();

  if (userError || !userData.user) {
    return jsonResponse({ error: "Sessão inválida." }, 401);
  }

  let empresaId = body.empresa_id || "";

  const { data: vinculos, error: vinculoError } = await userClient
    .from("usuarios_empresas")
    .select("empresa_id, perfil, perfil_admin, ativo")
    .eq("user_id", userData.user.id)
    .eq("ativo", true);

  if (vinculoError || !vinculos || vinculos.length === 0) {
    return jsonResponse({ error: "Usuário sem vínculo ativo." }, 403);
  }

  const vinculo = empresaId
    ? vinculos.find((item) => item.empresa_id === empresaId)
    : vinculos[0];

  if (!vinculo) {
    return jsonResponse({ error: "Empresa não autorizada." }, 403);
  }

  const perfil = vinculo.perfil_admin || vinculo.perfil;
  const perfisPermitidos = ["gestor", "admin", "super_admin", "rh", "auditor", "supervisor"];

  if (!perfisPermitidos.includes(perfil)) {
    return jsonResponse({ error: "Perfil sem permissão para exportar." }, 403);
  }

  empresaId = vinculo.empresa_id;

  const { data: empresa, error: empresaError } = await serviceClient
    .from("empresas")
    .select("*")
    .eq("id", empresaId)
    .single();

  if (empresaError || !empresa) {
    return jsonResponse({ error: "Empresa não encontrada." }, 404);
  }

  const { data: registros, error: registrosError } = await serviceClient
    .from("registros_ponto")
    .select("id, empresa_id, funcionario_id, tipo, nsr, data_hora, data_hora_servidor, hash_registro, funcionarios(nome_completo, cpf, pis)")
    .eq("empresa_id", empresaId)
    .gte("data_hora", inicio)
    .lt("data_hora", fim)
    .is("cancelado_em", null)
    .order("nsr", { ascending: true });

  if (registrosError) {
    return jsonResponse({ error: registrosError.message }, 400);
  }

  const registrosOrdenados = (registros || []) as RegistroPonto[];
  const arquivo = tipo === "afd"
    ? await gerarAfd(empresa, registrosOrdenados, inicio, fim)
    : await gerarAej(empresa, registrosOrdenados, inicio, fim);

  const documento = onlyDigits(empresa.cnpj || empresa.cpf || empresaId).slice(0, 14) || empresaId;
  const emitidoEm = new Date().toISOString();
  const extensao = tipo === "afd" ? "txt" : "csv";
  const filename = `${tipo.toUpperCase()}_${documento}_${inicio.slice(0, 10)}_${fim.slice(0, 10)}.${extensao}`;

  await serviceClient.from("rep_p_auditoria").insert({
    empresa_id: empresaId,
    user_id: userData.user.id,
    acao: `exportar_${tipo}`,
    detalhe: {
      inicio,
      fim,
      filename,
      hash_arquivo: arquivo.hash,
      qtd_registros: registrosOrdenados.length,
    },
    user_agent: req.headers.get("User-Agent") || "",
  });

  await serviceClient.from("rep_p_exportacoes").insert({
    empresa_id: empresaId,
    user_id: userData.user.id,
    tipo,
    filename,
    inicio,
    fim,
    hash_arquivo: arquivo.hash,
    qtd_registros: registrosOrdenados.length,
    observacao: arquivo.observacao,
  });

  return jsonResponse({
    success: true,
    tipo,
    filename,
    emitido_em: emitidoEm,
    hash_arquivo: arquivo.hash,
    qtd_registros: registrosOrdenados.length,
    mime_type: tipo === "afd" ? "text/plain;charset=iso-8859-1" : "text/csv;charset=utf-8",
    conteudo_base64: toBase64(arquivo.conteudo),
    observacao: arquivo.observacao,
  });
});
