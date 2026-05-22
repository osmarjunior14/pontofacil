# Supabase - REP-P

Este diretório versiona as mudanças de backend necessárias para REP-P.

## Aplicar migração

Execute a migração `migrations/202605220001_rep_p_compliance.sql` no projeto Supabase antes de publicar as funções.

Ela cria/adiciona:

- campos de NSR, hash, assinatura e auditoria em `registros_ponto`;
- tabela `rep_p_nsr_contadores`;
- tabela `rep_p_auditoria`;
- RLS de leitura;
- trigger que bloqueia escrita direta em `registros_ponto`;
- RPC `registrar_ponto_rep_p` com NSR transacional e hash SHA-256.

## Publicar funções

Funções:

- `registrar-ponto`
- `exportar-afd-aej`
- `validar-afd`
- `rep-p-health`
- `registrar-consentimento-biometria`

Variáveis esperadas pelo runtime Supabase:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` apenas para `exportar-afd-aej`

## Observação fiscal

O AFD retornado por `exportar-afd-aej` inclui o conteúdo e o hash do arquivo, mas a assinatura P7S com certificado ICP-Brasil do desenvolvedor/fabricante precisa ser configurada no ambiente de produção antes da entrega fiscal.
