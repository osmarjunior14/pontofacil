# Auditoria REP-P - PontoFacil

Data: 2026-05-22

Referencias oficiais consultadas:
- MTE - Registro Eletronico de Ponto: https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/rep
- MTE - Portaria MTP 671/2021 compilada: https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/legislacao/portarias-1/portarias-vigentes-3/PDFPortarian671de8denovembrode2021compilada07.01.2026.pdf
- MTE - Perguntas e Respostas REP: https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP

## Situacao encontrada

O projeto e um front-end estatico em HTML/JS usando Supabase Auth, Storage, tabelas e Edge Functions. A pagina critica de marcacao e `ponto.html`, que envia a marcacao para a Edge Function `registrar-ponto`.

Foram encontrados estes pontos criticos:

- `ponto.html` estava com o fechamento do `fetch` incompleto, quebrando o script da pagina de registro de ponto.
- O mesmo anon key do Supabase estava repetido em varias paginas, dificultando manutencao e aumentando risco de configuracao divergente.
- A pagina de login geral redirecionava funcionarios para `bater-ponto.html`, arquivo inexistente no projeto.
- Varias telas montam HTML com dados vindos do banco usando `innerHTML`; isso exige escaping rigoroso para evitar XSS se algum campo cadastral ou URL vier contaminado.
- A sequencia do ponto, o intervalo minimo e algumas validacoes antifraude eram feitas no cliente antes do envio. Isso e util para UX, mas nao pode ser tratado como controle de seguranca ou conformidade, porque qualquer validacao client-side pode ser adulterada.

## Melhorias aplicadas no front-end

- Criado `js/security-compliance.js` com utilitarios para escaping, mensagens seguras, hash SHA-256 auxiliar e metadados de evidencia de cliente.
- `ponto.html` passou a usar `js/supabase-client.js`, removendo credencial duplicada.
- Corrigido o `fetch` da Edge Function `registrar-ponto`.
- `ponto.html` agora envia dentro de `device_info` evidencias auxiliares: versao do app, ID local do registro, horario ISO do cliente, timezone, user agent, plataforma, idioma e hash SHA-256 auxiliar do payload.
- `relatorio.html` passou a usar `js/supabase-client.js` e recebeu escaping em pontos sensiveis do relatorio.
- `relatorio.html` agora exibe campos de auditoria quando existirem no banco: NSR, hash/codigo de verificacao e horario de servidor.
- `login.html` passou a usar `js/supabase-client.js` e o redirecionamento de funcionario foi corrigido para `funcionario-dashboard.html`.
- Criada a migracao `supabase/migrations/202605220001_rep_p_compliance.sql` com NSR transacional, hash SHA-256 no servidor, bloqueio de escrita direta em `registros_ponto` e RLS de leitura.
- Criada a Edge Function `supabase/functions/registrar-ponto`, que chama a RPC oficial `registrar_ponto_rep_p`.
- Criada a Edge Function `supabase/functions/exportar-afd-aej`, que gera AFD REP-P e AEJ com hash de arquivo e log de auditoria.
- Criada a tela `exportacao.html` para gerar e baixar AFD/AEJ.
- Criadas as paginas `resetar-senha.html` e `redefinir-senha.html`.

## Requisitos REP-P que precisam ser garantidos no backend

Para aderencia real a Portaria 671/2021 em REP-P, os itens abaixo nao podem depender do navegador:

- NSR sequencial por estabelecimento, iniciando em 1 e incrementando unitariamente, conforme orientacao do MTE para REP-P.
- Data e hora oficiais geradas no servidor, com timezone e origem controlada.
- Gravacao imutavel do registro original. Edicoes, justificativas ou desconsideracoes devem ser novos eventos auditaveis, nunca alteracao silenciosa da marcacao original.
- Geracao do Arquivo Fonte de Dados (AFD) no leiaute oficial aplicavel ao REP-P, incluindo nomenclatura com registro no INPI, CNPJ/CPF do empregador e `REP_P`.
- Campos de verificacao do AFD conforme leiaute oficial, incluindo CRC-16 nos registros previstos e SHA-256 onde exigido pelo leiaute.
- Assinatura/codigo de verificacao gerado no servidor para cada marcacao e para arquivos exportados.
- Controle transacional na Edge Function `registrar-ponto`, preferencialmente em funcao SQL/RPC com lock por empresa/estabelecimento, para impedir dois registros com o mesmo NSR em concorrencia.
- RLS no Supabase impedindo `insert`, `update` e `delete` diretos na tabela de registros por usuarios comuns. O registro de ponto deve ocorrer somente via Edge Function validada.
- Logs antifraude append-only com usuario autenticado, IP quando disponivel na Edge Function, user agent, geolocalizacao, precisao, distancia, resultado facial e motivo de bloqueio.
- Atestado Tecnico e Termo de Responsabilidade para uso do sistema como REP-P, conforme material oficial do MTE.

## Modelo recomendado de tabela/evento

Campos minimos recomendados em `registros_ponto`:

- `id`
- `empresa_id`
- `estabelecimento_documento`
- `funcionario_id`
- `cpf_funcionario`
- `tipo`
- `nsr`
- `data_hora_servidor`
- `timezone`
- `foto_url`
- `latitude`
- `longitude`
- `precisao_gps`
- `distancia_metros`
- `captura_ao_vivo`
- `metodo_captura`
- `score_fraude`
- `nivel_fraude`
- `device_info`
- `hash_registro`
- `assinatura_servidor`
- `created_by`
- `created_at`
- `cancelado_em`
- `cancelado_por`
- `motivo_cancelamento`

## Prioridade de proximas correcoes

1. Aplicar a migracao Supabase em `supabase/migrations/202605220001_rep_p_compliance.sql`.
2. Publicar as Edge Functions `registrar-ponto` e `exportar-afd-aej`.
3. Configurar assinatura P7S/ICP-Brasil para o AFD gerado em producao.
4. Validar o AFD gerado contra o validador/leiaute oficial mais recente do MTE.
5. Completar o AEJ no leiaute oficial do PTRP caso o PontoFacil tambem seja usado como Programa de Tratamento, e nao apenas como REP-P.
6. Revisar politicas RLS antigas no Supabase remoto e remover qualquer policy de `insert`, `update` ou `delete` direto em `registros_ponto`.
