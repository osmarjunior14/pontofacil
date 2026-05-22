import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

type RegistroPayload = {
  empresa_id?: string;
  tipo?: string;
  observacao?: string;
  foto_url?: string;
  latitude?: number;
  longitude?: number;
  precisao_gps?: number;
  distancia_metros?: number;
  captura_ao_vivo?: boolean;
  metodo_captura?: string;
  score_fraude?: number;
  nivel_fraude?: string;
  device_info?: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization") || "";

  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: "Configuração Supabase ausente." }, 500);
  }

  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão ausente." }, 401);
  }

  let body: RegistroPayload;

  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }

  if (!body.empresa_id || !body.tipo) {
    return jsonResponse({ error: "Empresa e tipo são obrigatórios." }, 400);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: userError } =
    await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonResponse({ error: "Sessão inválida." }, 401);
  }

  const userAgent = req.headers.get("User-Agent") || "";
  const forwardedFor =
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    "";

  const deviceInfo = {
    ...(body.device_info || {}),
    user_agent_servidor: userAgent,
    ip_origem: forwardedFor.split(",")[0]?.trim() || "",
  };

  const { data, error } = await supabase.rpc("registrar_ponto_rep_p", {
    p_empresa_id: body.empresa_id,
    p_tipo: body.tipo,
    p_observacao: body.observacao || null,
    p_foto_url: body.foto_url || null,
    p_latitude: body.latitude ?? null,
    p_longitude: body.longitude ?? null,
    p_precisao_gps: body.precisao_gps ?? null,
    p_distancia_metros: body.distancia_metros ?? null,
    p_captura_ao_vivo: body.captura_ao_vivo ?? true,
    p_metodo_captura: body.metodo_captura || "camera",
    p_score_fraude: body.score_fraude ?? 0,
    p_nivel_fraude: body.nivel_fraude || "baixo",
    p_device_info: deviceInfo,
  });

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse({
    success: true,
    registro: data,
    nsr: data?.nsr,
    hash_registro: data?.hash_registro,
    data_hora_servidor: data?.data_hora_servidor || data?.data_hora,
  });
});
