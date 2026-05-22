# Roadmap Comercial REP-P - PontoFacil

Este documento resume o que foi implementado no repositório para transformar o PontoFacil em uma base comercial de REP-P e o que ainda depende de infraestrutura/credenciais.

## Implementado no projeto

- Migrações Supabase para NSR, hash, auditoria, RLS, dispositivos, offline, sincronismo, exportações, releases e configurações REP-P.
- Edge Functions:
  - `registrar-ponto`
  - `exportar-afd-aej`
  - `validar-afd`
  - `rep-p-health`
  - `registrar-consentimento-biometria`
- Telas:
  - `exportacao.html`
  - `rep-p-confiabilidade.html`
  - `termo-responsabilidade.html`
  - `lgpd-biometria.html`
  - `dispositivos-offline.html`
  - `resetar-senha.html`
  - `redefinir-senha.html`
- Registro de exportações em `rep_p_exportacoes`.
- Painel operacional para checar marcações sem NSR/hash, offline pendente, dispositivos e saúde do servidor.
- Documento de Atestado Técnico/Termo de Responsabilidade em HTML imprimível/PDF.

## Exige acesso ao Supabase

- Aplicar `supabase/migrations/202605220001_rep_p_compliance.sql`.
- Aplicar `supabase/migrations/202605220002_rep_p_comercial.sql`.
- Fazer deploy das Edge Functions.
- Revisar/remover policies antigas que permitam `insert`, `update` ou `delete` direto em `registros_ponto`.
- Configurar variáveis:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Exige certificado/infra externa

- Certificado ICP-Brasil do desenvolvedor/fabricante para assinatura P7S do AFD.
- Armazenamento seguro de chave/certificado, preferencialmente fora do front-end e fora do banco.
- Fonte confiável de Hora Legal Brasileira para medir drift real.
- Processo de backup/restore testado e documentado.
- Validação oficial do AFD/AEJ antes de venda.

## Antes da comercialização

- Rodar bateria de testes em ambiente de homologação.
- Emitir e assinar o Atestado Técnico/Termo de Responsabilidade por versão.
- Registrar evidência de release com hash do pacote publicado.
- Revisar LGPD/biometria com advogado ou DPO.
- Definir SLA, suporte, retenção e política de exportação após cancelamento.
