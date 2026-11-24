/* Operator import only changes the shared operator catalog, never vehicle accounts. */
window.ChecklistOperatorImport = (() => {
  const key=name=>String(name || '').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');
  function plan(payload,existing,vehicles) {
    if(payload?.format!=='checklist-operators-v1' || !Array.isArray(payload.operators) || payload.operators.length>1000)
      throw Error('Arquivo de operadores inválido.');
    const prefixes=new Set(vehicles.map(row=>row.prefix));
    const names=new Set(existing.map(row=>key(row.name))), added=[], unknown=new Set();
    let skipped=0;
    for(const input of payload.operators) {
      const name=String(input.name || '').trim().replace(/\s+/g,' ');
      if(!name || name.length>80 || !Array.isArray(input.vehicles))throw Error('Nome ou vínculo inválido no arquivo.');
      if(names.has(key(name))){skipped++;continue}
      const links=[];
      for(const prefix of input.vehicles) {
        if(typeof prefix!=='string' || !/^ITG-\d{3}$/.test(prefix))throw Error('Prefixo inválido.');
        if(prefixes.has(prefix))links.push(prefix);else unknown.add(prefix);
      }
      names.add(key(name));added.push({id:crypto.randomUUID(),name,vehicles:[...new Set(links)]});
    }
    if(existing.length+added.length>1000)throw Error('O limite é de 1.000 operadores.');
    return {added,skipped,unknown:[...unknown].sort(),unlinked:added.filter(row=>!row.vehicles.length).length};
  }
  function mount() {
    const section=byId('operadores');if(!section)return;
    const box=document.createElement('details');box.id='operator-import';
    box.innerHTML='<summary>Importar operadores da escala</summary><label>Lista de operadores<input type="file" accept=".json,application/json"></label><button type="button">Revisar lista</button><p role="status"></p><button type="button" hidden>Adicionar operadores</button>';
    section.append(box);
    const input=box.querySelector('input'),[review,apply]=box.querySelectorAll('button'),status=box.querySelector('[role="status"]');
    let payload;
    input.onchange=()=>{payload=null;apply.hidden=true;status.textContent=''};
    review.onclick=async()=>{
      apply.hidden=true;
      try{
        if(!window.checklistCloud?.canOpen('operadores'))throw Error('Entre com uma conta autorizada a cadastrar operadores.');
        const file=input.files[0];if(!file)throw Error('Selecione o arquivo de operadores.');
        if(file.size>1000000)throw Error('Arquivo muito grande.');
        payload=JSON.parse(await file.text());const result=plan(payload,operators(),state.vehicles);
        status.textContent=result.added.length+' operadores novos · '+result.skipped+' já cadastrados · '+result.unlinked+' sem vínculo.'+
          (result.unknown.length?' Prefixos não cadastrados: '+result.unknown.join(', ')+'. Os nomes serão incluídos sem esses vínculos.':'');
        apply.hidden=!result.added.length;
      }catch(failure){payload=null;status.textContent=failure.message}
    };
    apply.onclick=()=>{
      if(!payload)return;
      try{
        if(!window.checklistCloud?.canOpen('operadores'))throw Error('Conta sem permissão para cadastrar operadores.');
        const result=plan(payload,operators(),state.vehicles);
        if(!save({...state,operators:[...operators(),...result.added]}))return;
        refresh();window.checklistCloud.recordSaved(result.added.length+' operadores salvos');
        status.textContent=result.added.length+' operadores adicionados ao aparelho. Aguarde a confirmação “Dados sincronizados” para concluir o envio.';
        apply.hidden=true;payload=null;
      }catch(failure){status.textContent=failure.message}
    };
  }
  return {plan,mount};
})();
ChecklistOperatorImport.mount();
