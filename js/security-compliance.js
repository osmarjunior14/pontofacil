(function(){
  const APP_VERSION = "2026.05.22-rep-p-audit";
  const REP_P_TZ = "America/Sao_Paulo";

  function escapeHtml(value){
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setSafeHtml(element, html){
    if(!element) return;
    element.innerHTML = html;
  }

  function setSafeMessage(container, tipo, texto){
    if(!container) return;
    container.innerHTML = "";

    const box = document.createElement("div");
    box.className = tipo;
    box.textContent = texto;

    container.appendChild(box);
  }

  async function sha256Hex(value){
    const data = new TextEncoder().encode(String(value ?? ""));
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function criarEvidenciaCliente(payload){
    const dataHoraClienteIso = new Date().toISOString();
    const registroClienteId =
      (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const base = {
      app_version: APP_VERSION,
      origem: "pontofacil-web",
      tipo_rep: "REP-P",
      registro_cliente_id: registroClienteId,
      data_hora_cliente_iso: dataHoraClienteIso,
      timezone_referencia: REP_P_TZ,
      timezone_navegador:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      timezone_offset_minutos: new Date().getTimezoneOffset(),
      user_agent: navigator.userAgent,
      plataforma: navigator.platform,
      idioma: navigator.language
    };

    const hashBase = JSON.stringify({
      ...base,
      payload
    });

    return {
      ...base,
      hash_cliente_sha256: await sha256Hex(hashBase),
      observacao_conformidade:
        "Hash e horario gerados no cliente servem como evidencia auxiliar. NSR, data oficial, assinatura e AFD devem ser gerados no servidor."
    };
  }

  window.PontoFacilSecurity = {
    APP_VERSION,
    REP_P_TZ,
    escapeHtml,
    setSafeHtml,
    setSafeMessage,
    sha256Hex,
    criarEvidenciaCliente
  };
})();
