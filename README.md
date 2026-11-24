# Checklist de Viaturas DER

Interface instalável publicada no GitHub Pages. Cadastros e registros são enviados ao serviço autenticado do Apps Script indicado no `index.html`; o banco e as imagens não ficam neste repositório.

## Organização

- `index.html` e `app.css`: estrutura e aparência.
- `app.js`: viaturas, itens, operadores e checklist diário.
- `cloud.js`: autenticação, fila local, confirmação de envio, atualização ao abrir/retornar à tela e ao recuperar conexão.
- `catalog-sync.js`: comparação entre a base da edição, alterações locais e versão central. Inclusões simultâneas são conciliadas; alterações incompatíveis ficam pendentes.
- `operators-export.js`: ordenação por base/nome na tela, Excel e PDF paginado com logo do DER. Operadores sem vínculo ficam no fim.
- `operators-import.js`: revisão e inclusão de operadores sem duplicar nomes. Prefixos ausentes não são criados automaticamente.
- `catalog-import.js`: importação dos itens do checklist.
- `quinzenal.js`, `ocorrencias.js`, `relatorios.js` e `xlsx.js`: fluxos e exportações existentes.
- `register-sw.js`, `sw.js` e `instalar.js`: abertura offline, atualização do aplicativo e instalação.

## Persistência

Cada conta mantém sua fila local separada. Contas autorizadas usam o mesmo serviço central, de acordo com o perfil e a viatura permitidos. O app grava no aparelho antes de enviar e só indica sincronização após confirmação. Reabrir o app, recuperar conexão ou retornar à janela dispara nova tentativa. Uma consulta a cada 30 segundos mantém a tela aberta atualizada.

Administrador, Gestão e Engenheiro podem atualizar cadastros; Operador/VTR registra checklists e ocorrências; Consulta não grava. Exclusões continuam restritas ao responsável. A revogação é validada pelo servidor e não é contornada para enviar pendências.

Uma edição conflitante é preservada no aparelho e identificada na tela. Use **Backup dos cadastros** antes de trocar de conta ou limpar os dados do navegador. A fila não consegue enviar enquanto o aplicativo está fechado ou sem conexão.

## Verificação

Execute `node tests/catalog.test.cjs` , `node tests/sync.test.cjs` e `node tests/operators-export.test.cjs`. Os testes usam uma base isolada e não criam usuários nem registros reais. Validação do servidor Apps Script permanece necessária para alterações de permissão ou de regras de negócio.

Ao publicar arquivos novos, atualize a versão em `index.html` e `sw.js` e inclua as dependências no cache offline.
