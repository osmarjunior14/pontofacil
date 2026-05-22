import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Configuração Supabase ausente." }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const agora = new Date();

  const health = {
    status: "ok",
    server_time_iso: agora.toISOString(),
    timezone_referencia: "America/Sao_Paulo",
    hlb_status: "nao_verificado",
    hlb_drift_segundos: null,
    observacao:
      "Configure uma fonte confiável de Hora Legal Brasileira no ambiente de produção para preencher referencia_hlb e drift_segundos.",
  };

  await serviceClient.from("rep_p_sincronismo_hlb").insert({
    origem: "rep-p-health",
    data_hora_servidor: agora.toISOString(),
    status: health.hlb_status,
    detalhe: health,
  });

  return jsonResponse(health);
});
