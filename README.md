# Checklist de Viaturas DER

Interface instalável publicada no GitHub Pages. Cadastros e registros são enviados ao serviço autenticado do Apps Script indicado no `index.html`; o banco e as imagens não ficam neste repositório.

## Organização

- `index.html` e `app.css`: estrutura e aparência.
- `app.js`: viaturas, itens, operadores e checklist diário.
- `cloud.js`: autenticação, fila local, confirmação de envio, atualização ao abrir/retornar à tela e ao recuperar conexão.
- `mileage-budget.js` e `mileage-ui.js`: limite contratual por período, leitura inicial e saldo derivado dos checklists confirmados. O painel usa a mesma regra.
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

## Controle de KM

Em **Viaturas → Editar viatura**, habilite o controle e informe limite, odômetro inicial e data inicial. A data final é opcional. O período pode corresponder ao mês, ao contrato ou a outro intervalo definido pela administração. Nenhum limite real é preenchido automaticamente. A configuração é salva no mesmo cadastro compartilhado da viatura.

**Saldo de KM** no app e **KM disponível** no painel calculam a leitura mais recente válida menos o odômetro inicial. O saldo é o limite menos essa distância. Reenvios não descontam novamente, a ordem de chegada offline não altera o resultado, checklists individuais com leitura válida também contam e o saldo negativo identifica excesso. O histórico não é modificado. Os limites usam datas de Brasília e a data final inclui o dia inteiro.

Sem leitura no período, o saldo fica aguardando o primeiro checklist. Leituras inválidas ou decrescentes não produzem um saldo definitivo e exigem revisão. Para troca de odômetro, a administração deve revisar a configuração; o app não presume que a redução significa um reinício válido. Só registros confirmados na base entram no painel. A atualização segue a sincronização do app e a consulta automática do painel.

As metas respeitam os perfis existentes: Administração, Gestão e Engenheiro podem consultar os limites disponíveis no cadastro; um escopo de viatura limita a apuração ao respectivo prefixo. O perfil Consulta não recebe as configurações de cadastro do servidor e é informado disso no painel. Conta de VTR não pode alterar limites.

Teste do cálculo: `node tests/mileage-budget.test.cjs`.
