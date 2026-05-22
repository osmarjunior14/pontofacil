import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

type Payload = {
  conteudo_base64?: string;
};

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  let body: Payload;

  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }

  if (!body.conteudo_base64) {
    return jsonResponse({ error: "Arquivo obrigatório." }, 400);
  }

  const conteudo = fromBase64(body.conteudo_base64);
  const linhas = conteudo.split(/\r\n/).filter(Boolean);
  const erros: string[] = [];

  if (linhas.length < 3) {
    erros.push("AFD deve conter cabeçalho, registros e trailer.");
  }

  if (conteudo.includes("\n") && !conteudo.includes("\r\n")) {
    erros.push("Linhas devem terminar com CRLF.");
  }

  if (!linhas[0]?.startsWith("0000000001")) {
    erros.push("Cabeçalho tipo 1 não identificado.");
  }

  const trailer = linhas.find((linha) => linha.startsWith("999999999"));

  if (!trailer) {
    erros.push("Trailer tipo 9 não identificado.");
  }

  const nsrs = linhas
    .filter((linha) => /^\d{9}3/.test(linha))
    .map((linha) => Number(linha.slice(0, 9)));

  const foraDeOrdem = nsrs.some((nsr, index) => index > 0 && nsr < nsrs[index - 1]);

  if (foraDeOrdem) {
    erros.push("Registros de marcação não estão ordenados por NSR.");
  }

  return jsonResponse({
    valido: erros.length === 0,
    erros,
    qtd_linhas: linhas.length,
    qtd_marcacoes: nsrs.length,
    hash_sha256: await sha256Hex(conteudo),
    observacao:
      "Validação estrutural auxiliar. Use também o leiaute oficial e a validação jurídica/contábil antes de entrega fiscal.",
  });
});
