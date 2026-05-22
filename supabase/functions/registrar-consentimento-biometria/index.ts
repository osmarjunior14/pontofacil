import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

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

  const body = await req.json().catch(() => ({}));
  const versao = String(body.versao || "2026.05");

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonResponse({ error: "Sessão inválida." }, 401);
  }

  const { data: funcionario, error: funcionarioError } = await supabase
    .from("funcionarios")
    .select("id, empresa_id")
    .eq("auth_user_id", userData.user.id)
    .single();

  if (funcionarioError || !funcionario) {
    return jsonResponse({ error: "Funcionário não encontrado." }, 404);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "";

  const userAgent = req.headers.get("User-Agent") || "";
  const agora = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("funcionarios")
    .update({
      consentimento_biometria_em: agora,
      consentimento_biometria_ip: ip,
      consentimento_biometria_user_agent: userAgent,
      consentimento_biometria_versao: versao,
    })
    .eq("id", funcionario.id);

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 400);
  }

  await supabase.from("rep_p_auditoria").insert({
    empresa_id: funcionario.empresa_id,
    funcionario_id: funcionario.id,
    user_id: userData.user.id,
    acao: "consentimento_biometria",
    detalhe: { versao },
    ip,
    user_agent: userAgent,
  });

  return jsonResponse({
    success: true,
    consentimento_biometria_em: agora,
    versao,
  });
});
