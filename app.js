const services = {0:'Inspeção',1:'Apoio',2:'Guincho leve',4:'Guincho pesado',6:'Boiadeiro',7:'Combate a incêndio'};
const byId = id => document.getElementById(id);
const handover = byId('handover'), fields = handover.elements, fleet = byId('fleet'), catalog = byId('catalog');
const escape = value => String(value ?? '').replace(/[&<>"']/g, symbol => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[symbol]);
const key = 'der-field-checklist-v1';
function referencePhoto(item) {
  const source=item.photo;
  if(!source)return null;
  const button=document.createElement('button'), thumbnail=document.createElement('img');
  button.type='button';button.className='reference';
  button.setAttribute('aria-label','Ampliar foto de referência: '+item.title);
  thumbnail.src=source;thumbnail.alt='';thumbnail.loading='lazy';thumbnail.decoding='async';
  button.append(thumbnail);
  button.onclick=()=>{
    byId('photo-title').textContent=item.title+(item.photo?'':' · Foto ilustrativa');
    byId('photo-full').src=source;byId('photo-full').alt='Foto de referência: '+item.title;
    byId('photo-dialog').showModal();
  };
  return button;
}
const initial = {
  vehicles:[{prefix:'ITG-324',plate:'',active:true}],
  items:[{id:'1',title:'Pneus — exemplo',scope:'all',critical:true,active:true},{id:'2',title:'Luzes e sinalização — exemplo',scope:'all',critical:true,active:true},{id:'3',title:'Cabo e gancho — exemplo',scope:'s:2',critical:true,active:true}],
  records:[]
};
let state, resumed = null, shown = [], pads = {};
try { state = JSON.parse(localStorage.getItem(key)) || initial; } catch { state = initial; }
function save(next) {
  try {
    const cloud=window.checklistCloud, previous=state;
    if (cloud?.enabled) cloud.persist(previous,next);
    else localStorage.setItem(key,JSON.stringify(next));
    state=next;
    return true;
  }
  catch (error) { alert(error.message || 'Não foi possível gravar no navegador. O formulário foi mantido.'); return false; }
}
const decode = prefix => /^ITG-[0-9][012467][0-9]$/.test(prefix) ? 'Base '+prefix[4]+' · '+services[prefix[5]]+' · Sequencial '+prefix[6] : '';
const time = date => new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(date));
const option = (value,label) => '<option value="'+escape(value)+'">'+escape(label)+'</option>';
const itemScopes = item => item.scopes || [item.scope];
const itemsForVehicle = prefix => prefix ? state.items.filter(item=>item.active &&
  itemScopes(item).some(scope=>['all','s:'+prefix[5],'v:'+prefix].includes(scope))) : [];
const scopeLabel = scope => scope==='all'?'Toda a frota':scope.startsWith('s:')?services[scope.slice(2)]:scope.slice(2);
const selectedScopes = () => [...catalog.querySelectorAll('[name="target"]:checked')].map(input=>input.value);
let editingItem=null, editingVehicle=null;
function resetFleet() {
  editingVehicle=null;fleet.reset();window.ChecklistMileageUI?.reset();fleet.elements.prefix.readOnly=false;
  byId('decoded').textContent='';byId('fleet-save').textContent='Adicionar viatura';byId('fleet-cancel').hidden=true;
}
byId('fleet-cancel').onclick=resetFleet;
let editingOperator=null;
const operatorForm=byId('operator-form');
const operators=()=>state.operators||[];
const canDeleteCatalog=()=>window.checklistCloud?.canDeleteCatalog!==false;
function refreshOperatorChoices(reset=false) {
  const prefix=fields.vehicle.value;
  const linked=operators().filter(operator=>operator.vehicles.includes(prefix));
  const eligible=prefix?(fields.coverage.checked?[...linked,...operators().filter(operator=>!linked.includes(operator))]:linked):[];
  for(const role of ['outgoing','incoming','operator']){
    const select=fields[role], prior=reset?'':select.value, recorded=resumed?.[role];
    const names=eligible.map(operator=>operator.name);
    select.innerHTML=option('','Selecione')+eligible.map(operator=>option(operator.name,operator.name+(linked.includes(operator)?'':' · Substituto'))).join('')+
      (recorded&&!names.includes(recorded)?option(recorded,recorded+' · Registro original'):'');
    select.value=prior||recorded||'';
  }
  byId('operator-hint').textContent=prefix&&!linked.length?'Esta viatura ainda não tem operadores vinculados. Marque Operador substituto para buscar outros nomes.':'';
}
function renderOperatorAdmin(selected=[...operatorForm.querySelectorAll('[name="usualVehicle"]:checked')].map(input=>input.value)) {
  byId('operator-vehicles').innerHTML=state.vehicles.map(vehicle=>'<label class="scope-choice"><input type="checkbox" name="usualVehicle" value="'+escape(vehicle.prefix)+'" '+(selected.includes(vehicle.prefix)?'checked':'')+'> '+escape(vehicle.prefix)+(vehicle.active?'':' · Inativa')+'</label>').join('')||'<p>Cadastre uma viatura no menu Viaturas. Você também pode deixar o operador sem vínculo para cobertura.</p>';
  const ordered=window.ChecklistOperatorExport?.ordered(operators());
  const entries=ordered?ordered.map(row=>row.operator):operators();
  byId('operator-list').innerHTML=entries.map((operator,index)=>(ordered && (!index || ordered[index].base!==ordered[index-1].base)?'<h2 class="operator-base-title">'+escape(ordered[index].base)+'</h2>':'')+'<details><summary>'+escape(operator.name)+'</summary><p>'+escape(operator.vehicles.join(', ')||'Sem viatura habitual')+'</p><div class="actions"><button type="button" data-edit="'+index+'">Editar</button><button type="button" class="delete-button" data-remove="'+index+'">Excluir</button></div></details>').join('')||'<article>Nenhum operador cadastrado.</article>';
  byId('operator-list').querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>{
    const operator=entries[Number(button.dataset.edit)];editingOperator=operator.id;
    operatorForm.elements.operatorName.value=operator.name;renderOperatorAdmin(operator.vehicles);
    byId('operator-save').textContent='Salvar alterações';byId('operator-cancel').hidden=false;
    operatorForm.elements.operatorName.focus();
  });
  byId('operator-list').querySelectorAll('[data-remove]').forEach(button=>{button.hidden=!canDeleteCatalog();button.onclick=()=>{
    if(!canDeleteCatalog())return;
    const operator=entries[Number(button.dataset.remove)];
    if(confirm('Excluir '+operator.name+' do cadastro? O histórico será mantido.')&&save({...state,operators:operators().filter(entry=>entry.id!==operator.id)})){
      if(editingOperator===operator.id)resetOperatorForm();
      buildPads([]);refresh();
    }
  };});
}
function resetOperatorForm(){
  editingOperator=null;operatorForm.reset();renderOperatorAdmin([]);
  byId('operator-save').textContent='Adicionar operador';byId('operator-cancel').hidden=true;
}
byId('operator-cancel').onclick=resetOperatorForm;
operatorForm.onsubmit=event=>{
  event.preventDefault();
  const name=operatorForm.elements.operatorName.value.trim(), vehicles=new FormData(operatorForm).getAll('usualVehicle');
  if(!name)return alert('Informe o nome do operador.');
  if(operators().some(operator=>operator.id!==editingOperator&&operator.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))return alert('Já existe um operador com esse nome. Diferencie os nomes para identificar cada pessoa.');
  const operator={id:editingOperator||crypto.randomUUID(),name,vehicles};
  const entries=editingOperator?operators().map(entry=>entry.id===editingOperator?operator:entry):[...operators(),operator];
  if(save({...state,operators:entries})){resetOperatorForm();buildPads([]);refresh();}
};
function renderScopes(scopes=selectedScopes()) {
  const choices=values=>values.map(value=>'<label class="scope-choice"><input type="checkbox" name="target" value="'+escape(value)+'" '+(scopes.includes(value)?'checked':'')+'> '+escape(scopeLabel(value))+'</label>').join('');
  byId('service-scopes').innerHTML=choices(Object.keys(services).map(code=>'s:'+code));
  byId('vehicle-scopes').innerHTML=choices(state.vehicles.map(vehicle=>'v:'+vehicle.prefix))||'<p>Nenhuma viatura cadastrada.</p>';
  byId('scope-options').hidden=catalog.elements.all.checked;
}
catalog.elements.all.onchange=()=>{byId('scope-options').hidden=catalog.elements.all.checked;};
function resetCatalog() {
  editingItem=null;catalog.reset();renderScopes([]);
  byId('save-item').textContent='Adicionar item';byId('cancel-item').hidden=true;
}
byId('cancel-item').onclick=()=>{resetCatalog();byId('catalog-status').textContent='Edição cancelada.';};
let historyKind='daily';
function page(name) {
  if(window.checklistCloud?.enabled&&!window.checklistCloud.canOpen(name))return;
  const sectionId=name==='historico-quinzenal'?'historico':name;
  document.querySelectorAll('main > section').forEach(section => section.hidden=section.id!==sectionId);
  document.querySelectorAll('nav button').forEach(button=>{
    if(button.dataset.page===name){button.setAttribute('aria-current','true');byId('area-title').textContent=button.textContent.trim();}
    else button.removeAttribute('aria-current');
  });
  if(sectionId==='historico') {
    switchHistory(name==='historico'?'daily':'fortnight');
    byId('history-title').textContent=historyKind==='daily'?'Histórico de trocas de turno':'Histórico quinzenal';
    byId('fortnight-records').hidden=historyKind==='daily';
    byId('fortnight-filter-count').hidden=historyKind==='daily';
    byId('records').hidden=historyKind==='fortnight';
    byId('prepare-report').hidden=window.checklistCloud?.canReport===false;
    byId('export-excel').hidden=window.checklistCloud?.canExportExcel===false;
    if(historyKind==='daily') historyView(); else refreshFortnightHistory();
  }
  if(name==='quinzenal') refreshFortnightChoices();
  if(name==='troca') { renderChecks(); restoreDailyDraft(); }
  byId('fortnight-coverage').hidden = true;
  refreshLaunchReviews();
  if(name==='km-saldo')window.ChecklistMileageUI?.render();
  if(name==='ocorrencias') refreshIncidentChoices();
  if(name==='historico-ocorrencias') refreshIncidentHistory();
  if(name==='acessos') window.checklistCloud?.showAccess();
  window.scrollTo(0,0);
}
function setMenu(open) {
  byId('shell').classList.toggle('menu-open',open);
  byId('open-menu').setAttribute('aria-expanded',String(open));
  byId('workspace').inert=open;
  (open?byId('close-menu'):byId('open-menu')).focus();
}
byId('open-menu').onclick=()=>setMenu(true);
byId('close-menu').onclick=()=>setMenu(false);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&byId('shell').classList.contains('menu-open'))setMenu(false);});
matchMedia('(max-width:760px)').addEventListener('change',event=>{if(!event.matches&&byId('shell').classList.contains('menu-open'))setMenu(false);});
document.querySelectorAll('nav button').forEach(button => button.onclick=()=>{if(byId('shell').classList.contains('menu-open'))setMenu(false);byId('notice').textContent='';page(button.dataset.page);});
function refresh() {
  const prior=fields.vehicle.value;
  const available=state.vehicles.filter(vehicle=>vehicle.active||vehicle.prefix===resumed?.prefix);
  fields.vehicle.innerHTML=option('','Selecione o prefixo')+available.map(vehicle=>option(vehicle.prefix,vehicle.prefix+' · '+services[vehicle.prefix[5]])).join('');
  const selected=available.find(vehicle=>vehicle.prefix===prior)?.prefix;
  fields.vehicle.value=window.checklistCloud?.vehicle||selected||'';
  renderScopes();
  window.ChecklistMileageUI?.render();
  renderOperatorAdmin();
  refreshOperatorChoices();
  ChecklistFleet.syncFilter(state.vehicles);
  const fleetRows=ChecklistFleet.ordered(state.vehicles,ChecklistFleet.selected());
  for(const [area,list] of [['vehicles',fleetRows],['items',state.items]]) {
    byId(area).innerHTML=list.map((entry,index)=>{
      const group = area==='vehicles' && (!index || ChecklistFleet.base(entry.prefix)!==ChecklistFleet.base(list[index-1].prefix))
        ? '<h3>'+escape(ChecklistFleet.name(ChecklistFleet.base(entry.prefix)))+'</h3>' : '';
      return group+'<details><summary>'+escape(entry.prefix||entry.title)+(entry.active?'':' · inativo')+'</summary><p>'+escape(entry.prefix?[decode(entry.prefix),entry.plate].filter(Boolean).join(' · '):itemScopes(entry).map(scopeLabel).join(', '))+(entry.critical?' · Crítico':'')+'</p><button type="button" data-index="'+index+'">'+(entry.active?'Desativar':'Reativar')+'</button></details>';
    }).join('') || (area==='vehicles' ? '<p>Nenhuma viatura cadastrada nesta base.</p>' : '');
    byId(area).querySelectorAll('button').forEach(button=>button.onclick=()=>{
      const next={...state,[area]:state[area].map(entry=>entry===list[Number(button.dataset.index)]?{...entry,active:!entry.active}:entry)};
      if(save(next)){refresh(); renderChecks();}
    });
    byId(area).querySelectorAll('details').forEach((entry,index)=>{
      const target=list[index], remove=document.createElement('button');
      remove.type='button';remove.className='delete-button';remove.textContent='Excluir';
      remove.onclick=()=>deleteCatalogEntry(area,target);
      if(canDeleteCatalog())entry.append(' ',remove);
      if(area==='vehicles'){
        const edit=document.createElement('button'), email=document.createElement('p');
        email.textContent=target.email?'E-mail da VTR: '+target.email:'E-mail da VTR ainda não vinculado';
        entry.querySelector('p').after(email);
        edit.type='button';edit.textContent='Editar viatura';
        edit.onclick=()=>{
          editingVehicle=target.prefix;fleet.elements.prefix.value=target.prefix;fleet.elements.prefix.readOnly=true;
          fleet.elements.plate.value=target.plate||'';fleet.elements.vehicleEmail.value=target.email||'';window.ChecklistMileageUI?.fill(target);
          byId('decoded').textContent=decode(target.prefix);byId('fleet-save').textContent='Salvar alterações';byId('fleet-cancel').hidden=false;
          fleet.elements.vehicleEmail.focus();
        };
        entry.append(' ',edit);
      }
    });
    if(area==='items')byId(area).querySelectorAll('details').forEach((entry,index)=>{
      const item=list[index], label=document.createElement('label'), input=document.createElement('input'), edit=document.createElement('button');
      edit.type='button';edit.textContent='Editar item';
      edit.onclick=()=>{
        editingItem=item.id;catalog.elements.title.value=item.title;catalog.elements.critical.checked=item.critical;
        catalog.elements.expected.value=item.expected??'';
        catalog.elements.all.checked=itemScopes(item).includes('all');catalog.elements.photo.value='';renderScopes(itemScopes(item));
        byId('save-item').textContent='Salvar alterações';byId('cancel-item').hidden=false;
        byId('catalog-status').textContent='Editando: '+item.title;
        catalog.elements.title.focus();
      };
      entry.append(' ',edit);
      const preview=referencePhoto(item);
      if(preview)entry.querySelector('p').after(preview);
      label.textContent=item.photo?'Trocar foto de referência':preview?'Substituir foto ilustrativa':'Adicionar foto de referência';
      input.type='file';input.accept='image/jpeg,image/png,image/webp';
      input.onchange=async()=>{
        const file=input.files[0];
        if(!file)return;
        input.disabled=true;
        try {
          const photo=await preparePhoto(file);
          if(save({...state,items:state.items.map(current=>current.id===item.id?{...current,photo}:current)})){refresh();renderChecks();}
        } catch(error){alert(error.message);}
        finally{input.disabled=false;input.value='';}
      };
      label.append(input);entry.append(label);
    });
  }
}
function deleteCatalogEntry(area,target) {
  if(!canDeleteCatalog())return;
  const isVehicle=area==='vehicles', name=isVehicle?target.prefix:target.title;
  if(isVehicle) {
    const pending=state.records.some(record=>record.prefix===name&&record.mode==='deferred'&&!state.records.some(other=>other.prior===record.id));
    if(pending)return alert('Conclua o checklist adiado desta viatura antes de excluí-la.');
    if(state.items.some(item=>itemScopes(item).includes('v:'+name)))return alert('Há itens associados a este prefixo. Edite ou exclua esses itens antes de excluir a viatura.');
  }
  if(!confirm('Excluir definitivamente do cadastro: '+name+'? O histórico será mantido.'))return;
  const remaining=state[area].filter(entry=>isVehicle?entry.prefix!==target.prefix:entry.id!==target.id);
  const next={...state,[area]:remaining};
  if(isVehicle)next.operators=operators().map(operator=>({...operator,vehicles:operator.vehicles.filter(prefix=>prefix!==target.prefix)}));
  if(!save(next))return;
  if(!isVehicle&&editingItem===target.id)resetCatalog();
  if(isVehicle&&editingVehicle===target.prefix)resetFleet();
  buildPads([]);refresh();renderChecks();
  byId('notice').textContent=(isVehicle?'Viatura excluída':'Item excluído')+' do cadastro.';
}
fleet.elements.prefix.oninput=()=>byId('decoded').textContent=decode(fleet.elements.prefix.value.trim().toUpperCase());
fleet.onsubmit=event=>{
  event.preventDefault();
  const prefix=fleet.elements.prefix.value.trim().toUpperCase();
  if(!decode(prefix)) return alert('Use ITG-XYS, com um código de serviço válido (0, 1, 2, 4, 6 ou 7).');
  const email=fleet.elements.vehicleEmail.value.trim().toLowerCase(), plate=fleet.elements.plate.value.trim().toUpperCase();
  if(state.vehicles.some(vehicle=>vehicle.prefix===prefix&&vehicle.prefix!==editingVehicle))return alert('Este prefixo já está cadastrado.');
  if(email&&state.vehicles.some(vehicle=>vehicle.prefix!==editingVehicle&&vehicle.email?.toLowerCase()===email))return alert('Este e-mail já está vinculado a outra viatura.');
  if(!window.ChecklistMileageUI)return alert('Aguarde o controle de km carregar e tente novamente.');
  let kmBudget;try{kmBudget=window.ChecklistMileageUI.read()}catch(error){return alert(error.message)}
  const vehicles=editingVehicle?state.vehicles.map(vehicle=>vehicle.prefix===editingVehicle?{...vehicle,email,plate,kmBudget}:vehicle):[...state.vehicles,{prefix,email,plate,kmBudget,active:true}];
  if(save({...state,vehicles})){resetFleet();refresh();byId('notice').textContent='Cadastro da viatura salvo no aparelho. Aguarde a confirmação de sincronização.';}
};
async function preparePhoto(file) {
  if(!file)return '';
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw new Error('Escolha uma imagem JPG, PNG ou WebP de até 15 MB.');
  const url=URL.createObjectURL(file), photo=new Image();
  try {
    photo.src=url;
    try{await photo.decode();}catch{throw new Error('Não foi possível abrir a foto. Escolha outra imagem.');}
    const scale=Math.min(1,800/Math.max(photo.width,photo.height)), canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(photo.width*scale));canvas.height=Math.max(1,Math.round(photo.height*scale));
    const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(photo,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.75);
  }finally{URL.revokeObjectURL(url);}
}
catalog.onsubmit=async event=>{
  event.preventDefault();
  const title=catalog.elements.title.value.trim();
  if(!title)return alert('Informe o nome do item.');
  const scopes=catalog.elements.all.checked?['all']:selectedScopes();
  if(!scopes.length)return alert('Marque ao menos um serviço ou prefixo, ou selecione Toda a frota.');
  const original=state.items.find(entry=>entry.id===editingItem);
  const expected = catalog.elements.expected.value==='' ? null : catalog.elements.expected.valueAsNumber;
  if(expected!==null&&(!Number.isInteger(expected)||expected<1||expected>9999))return alert('Informe uma quantidade esperada entre 1 e 9999.');
  const item={...original,id:original?.id||String(Date.now()),title,scopes,expected,critical:catalog.elements.critical.checked,active:original?.active??true};
  const button=byId('save-item'), file=catalog.elements.photo.files[0];
  byId('cancel-item').disabled=true;
  button.disabled=true;
  try{if(file)item.photo=await preparePhoto(file);}catch(error){alert(error.message);return;}finally{button.disabled=false;byId('cancel-item').disabled=false;}
  const items=original?state.items.map(entry=>entry.id===item.id?{...entry,title:item.title,scopes:item.scopes,expected:item.expected,critical:item.critical,...(file?{photo:item.photo}:{})}:entry):[...state.items,item];
  if(save({...state,items})){resetCatalog();refresh();renderChecks();byId('catalog-status').textContent=original?'Alterações salvas.':'Item adicionado.';}
};
const vehicleDailyChecks = [
  {id:'daily-vehicle-condition',title:'Condição da viatura',general:true},
  {id:'daily-vehicle-cleanliness',title:'Limpeza da viatura',general:true}
];
function renderChecks() {
  const prefix=fields.vehicle.value;
  const prior=shown.map(item=>({id:item.id,value:fields['check-'+item.id]?.value,note:fields['note-'+item.id]?.value,found:fields['found-'+item.id]?.value}));
  byId('vehicle-info').textContent=decode(prefix);
  const emptyMessage=prefix?'Nenhum item ativo para '+prefix+'. Verifique a abrangência no Cadastro do Checklist.':
    state.vehicles.some(vehicle=>vehicle.active)?'Selecione a viatura acima para carregar os itens cadastrados para ela.':
      'Cadastre ou reative uma viatura no menu Viaturas para carregar os itens.';
  const equipment = itemsForVehicle(prefix);
  shown = equipment.length ? [...vehicleDailyChecks,...equipment] : [];
  byId('checks').innerHTML=shown.length?shown.map(item=>'<fieldset><legend>'+escape(item.title)+(item.critical?' <span class="daily-critical">Crítico</span>':'')+'</legend>'+
    (item.expected==null?'':'<p class="daily-requirement"><span class="daily-expected">Quantidade exigida: '+escape(item.expected)+'</span></p>')+
    '<div class="choices">'+['Conforme','Não Conforme'].map(value=>'<label><input type="radio" name="check-'+item.id+'" value="'+value+'">'+value+'</label>').join('')+
    '</div><label class="daily-note" hidden>Justificativa breve<input name="note-'+item.id+'" maxlength="300"></label></fieldset>').join(''):'<p>'+escape(emptyMessage)+'</p>';
  prior.forEach(result=>{
    const control=fields['check-'+result.id];
    if(control){control.value=result.value;fields['note-'+result.id].value=result.note;}
  });
  byId('checks').querySelectorAll('fieldset').forEach((group,index)=>{
    const item=shown[index], previous=prior.find(result=>result.id===item.id);
    if (item.general) return;
    const label=document.createElement('label'), found=document.createElement('input');
    label.className='daily-quantity';
    label.textContent='Quantidade encontrada';
    found.name='found-'+item.id;
    found.type='number';found.min='0';found.max='9999';found.step='1';found.inputMode='numeric';
    found.value=previous?.found||'';
    label.append(found);
    group.querySelector('.daily-note').before(label);
    const preview=referencePhoto(item);
    if(preview)group.querySelector('legend').after(preview);
  });
  update();
}
const isNonconforming = value => value==='Não Conforme'||value==='Problema';
function update() {
  const solo=fields.solo.checked;
  byId('handover-pair').hidden=solo;
  byId('handover-solo-operator').hidden=byId('handover-solo-reason').hidden=!solo;
  fields.outgoing.disabled=fields.incoming.disabled=solo;
  fields.operator.disabled=fields.reason.disabled=!solo;
  fields.operator.required=fields.reason.required=solo;
  byId('handover-instructions').textContent=solo?'Confira a viatura, informe o motivo e assine.':'Na troca de turno, confiram juntos e assinem. Meta: até 10 min.';
  byId('handover-signatures-title').textContent=solo?'3. Sua assinatura':'3. Assinaturas';
  fields.km.required=fields.fuel.required=true;
  let answered=0, critical=false;
  shown.forEach(item=>{
    const controls=[...handover.querySelectorAll('[name="check-'+item.id+'"]')];
    const value=controls.find(control=>control.checked)?.value;
    const note=fields['note-'+item.id], found=fields['found-'+item.id];
    const exception=isNonconforming(value);
    controls[0].required=true;
    if(found){found.parentElement.hidden=!exception;found.disabled=!exception;found.required=exception;}
    note.parentElement.hidden=!exception;
    note.required=exception;
    if(value)answered++;
    if(item.critical&&exception)critical=true;
  });
  byId('progress').textContent=answered+' de '+shown.length+' conferidos';
  byId('critical').hidden=!critical;
  const roles=solo?['operator']:['outgoing','incoming'];
  if(roles.join()!==Object.keys(pads).join()) buildPads(roles);
}
function signaturePads(container,roles) {
  const result={};
  container.replaceChildren();
  const captions={outgoing:'Quem entrega',incoming:'Quem recebe',operator:'Operador',engineer:'Engenheiro'};
  roles.forEach(role=>{
    const wrapper=document.createElement('div');
    wrapper.className='signature';
    const caption=captions[role], name=fields[role]?.value||'';
    const title=document.createElement('strong'), person=document.createElement('p'), preview=document.createElement('img');
    const button=document.createElement('button'), pad={canvas:null,ink:false};
    title.textContent=caption;
    person.className='signature-name';
    person.textContent=name;
    person.hidden=!name;
    preview.className='signature-preview';
    preview.alt='Assinatura confirmada de '+(name||caption);
    preview.hidden=true;
    button.type='button';button.className='primary';button.textContent='Assinar';
    button.setAttribute('aria-label','Assinar · '+caption);
    pad.showConfirmed=()=>{
      pad.image=pad.canvas.toDataURL();
      preview.src=pad.image;
      preview.hidden=false;
      button.textContent='Refazer assinatura';
      button.setAttribute('aria-label','Refazer assinatura · '+caption);
    };
    button.onclick=()=>openSignature(pad,caption,name,()=>{
      pad.showConfirmed();
      if (container===byId('pads')) saveDailyDraft();
    });
    wrapper.append(title,person,preview,button);
    container.append(wrapper);
    result[role]=pad;
  });
  return result;
}
function openSignature(pad,caption,name,onConfirm) {
  const dialog=byId('signature-dialog'), canvas=byId('signature-canvas'), ctx=canvas.getContext('2d');
  const confirmButton=byId('signature-confirm'), person=byId('signature-person');
  byId('signature-title').textContent='Assinatura · '+caption;
  person.textContent=name;
  person.hidden=!name;
  let ink=pad.ink, pointer=null;
  confirmButton.disabled=!ink;
  dialog.showModal();
  const resize=source=>{
    const box=canvas.getBoundingClientRect();
    const scale=Math.min(devicePixelRatio||1,1000/Math.max(box.width,box.height));
    const width=Math.max(1,Math.round(box.width*scale)), height=Math.max(1,Math.round(box.height*scale));
    if(!source&&canvas.width===width&&canvas.height===height)return;
    const copy=source||document.createElement('canvas');
    if(!source){copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);}
    canvas.width=width;canvas.height=height;
    if(ink&&copy.width&&copy.height){
      const factor=Math.min(width/copy.width,height/copy.height);
      const w=copy.width*factor,h=copy.height*factor;
      ctx.drawImage(copy,(width-w)/2,(height-h)/2,w,h);
    }
    ctx.lineWidth=2.6*scale;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#26382e';
    pointer=null;
  };
  if(!pad.canvas)ctx.clearRect(0,0,canvas.width,canvas.height);
  resize(pad.canvas);
  const watcher=new ResizeObserver(()=>resize());
  watcher.observe(canvas);
  const point=event=>{const box=canvas.getBoundingClientRect();return [
    (event.clientX-box.left)*canvas.width/box.width,(event.clientY-box.top)*canvas.height/box.height
  ];};
  canvas.onpointerdown=event=>{
    if(pointer!==null||event.button!==0)return;
    pointer=event.pointerId;canvas.setPointerCapture(pointer);ctx.beginPath();ctx.moveTo(...point(event));
  };
  canvas.onpointermove=event=>{
    if(event.pointerId!==pointer)return;
    ctx.lineTo(...point(event));ctx.stroke();ink=true;confirmButton.disabled=false;
  };
  canvas.onlostpointercapture=()=>{pointer=null;};
  byId('signature-clear').onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ink=false;confirmButton.disabled=true;};
  byId('signature-cancel').onclick=()=>dialog.close();
  confirmButton.onclick=()=>{
    if(!ink)return;
    pad.canvas=document.createElement('canvas');pad.canvas.width=canvas.width;pad.canvas.height=canvas.height;
    pad.canvas.getContext('2d').drawImage(canvas,0,0);
    pad.ink=true;onConfirm();dialog.close();refreshLaunchReviews();
  };
  dialog.onclose=()=>watcher.disconnect();
}
function buildPads(roles) { pads=signaturePads(byId('pads'),roles); }
function updateLaunchReview(form,key,signatures,itemCount) {
  const groups = new Set(), missing = {fields:0,items:0,photos:0,signatures:0};
  for (const control of form.elements) {
    if (!control.willValidate || control.closest('[hidden]')) continue;
    if (control.validity.valid && !(control.required && ['text','textarea'].includes(control.type) && !control.value.trim())) continue;
    const name = control.name;
    if (groups.has(name)) continue;
    groups.add(name);
    if (control.type==='file') missing.photos++;
    else if (/^(check-|note-|found-|tool-status-|tool-count-|tool-note-)/.test(name)) missing.items++;
    else missing.fields++;
  }
  missing.signatures = Object.values(signatures).filter(pad=>!pad.ink).length;
  const parts = [[missing.fields,'campo','campos'],[missing.items,'resposta de item','respostas de itens'],
    [missing.photos,'foto','fotos'],[missing.signatures,'assinatura','assinaturas']]
    .filter(([count])=>count).map(([count,one,many])=>count+' '+(count===1?one:many));
  const note = byId('review-'+key);
  const noItems = key==='daily' && itemCount===0 && Boolean(fields.vehicle.value);
  note.dataset.ready = String(!parts.length&&!noItems);
  note.textContent = parts.length ? 'Antes de salvar: '+parts.join(' · ')+'.'
    : noItems ? 'Cadastre os itens da viatura antes de salvar.' : 'Tudo pronto para salvar.';
}
function refreshLaunchReviews() {
  for (const [id,key,signatures,items] of [
    ['troca','daily',()=>pads,()=>shown.length],
    ['quinzenal','fortnight',()=>fortnightPads],
    ['ocorrencias','incident',()=>incidentPads]
  ]) {
    const section = byId(id);
    if (!section.hidden) updateLaunchReview(section.querySelector('form'),key,signatures(),items?.());
  }
}
for (const event of ['input','change','reset']) {
  document.addEventListener(event,({target})=>{
    if(target.closest?.('#handover,#fortnight-form,#incident-form')) queueMicrotask(refreshLaunchReviews);
  });
}
const padImages = signatures => Object.fromEntries(Object.entries(signatures).map(([role,pad])=>[role,pad.canvas.toDataURL()]));
const isSoloChecklist = record => record.solo===true;
let handoverStarted=null;
const dailyDraftFields=['km','fuel','outgoing','incoming','operator','reason'];
function dailyDraftKey() {
  const cloud=window.checklistCloud;
  if (cloud?.enabled) {
    if (!cloud.storageSuffix || !cloud.canOpen('troca') || cloud.isEngineerPreview) return null;
    return 'checklist-der-daily-draft'+cloud.storageSuffix;
  }
  return document.querySelector('meta[name="checklist-endpoint"]') ? null : 'checklist-der-daily-draft:local';
}
function draftStatus(message='',title=message?'Checklist pendente':'Checklist da passagem de turno') {
  byId('daily-draft-title').textContent=title;
  byId('daily-draft-status').textContent=message||'Preencha na próxima passagem de turno.';
}
function saveDailyDraft() {
  const key=dailyDraftKey();
  if (!key || !handoverStarted || !fields.vehicle.value) return;
  const draft={
    prefix:fields.vehicle.value,startedAt:handoverStarted,solo:fields.solo.checked,
    coverage:fields.coverage.checked,resumed,
    fields:Object.fromEntries(dailyDraftFields.map(name=>[name,fields[name].value])),
    results:shown.map(({id})=>[id,fields['check-'+id].value,fields['note-'+id].value,fields['found-'+id]?.value]),
    signatures:Object.fromEntries(Object.entries(pads).filter(([,pad])=>pad.ink&&pad.image).map(([role,pad])=>[role,pad.image]))
  };
  try {
    localStorage.setItem(key,JSON.stringify(draft));
    draftStatus('Rascunho salvo neste aparelho.');
  } catch {
    draftStatus('Não foi possível salvar o rascunho. Mantenha esta tela aberta até concluir.');
  }
}
function restoreDailyDraft() {
  const key=dailyDraftKey();
  if (!key || handoverStarted) return;
  let draft;
  try { draft=JSON.parse(localStorage.getItem(key)); } catch { return; }
  if (!draft || !Number.isFinite(draft.startedAt) ||
      !Array.from(fields.vehicle.options).some(option=>option.value===draft.prefix) ||
      (window.checklistCloud?.vehicle && window.checklistCloud.vehicle!==draft.prefix) ||
      !itemsForVehicle(draft.prefix).length) return;
  handoverStarted=draft.startedAt;
  resumed=draft.resumed||null;
  fields.vehicle.value=draft.prefix;
  fields.vehicle.disabled=Boolean(window.checklistCloud?.vehicle||resumed);
  byId('resuming').hidden=!resumed;
  fields.solo.checked=Boolean(draft.solo);
  fields.coverage.checked=Boolean(draft.coverage);
  refreshOperatorChoices();
  for (const name of dailyDraftFields) fields[name].value=draft.fields?.[name]||'';
  shown=[];
  buildPads([]);
  renderChecks();
  for (const [id,value,note,found] of draft.results||[]) {
    if (!fields['check-'+id]) continue;
    fields['check-'+id].value=value||'';
    fields['note-'+id].value=note||'';
    if (fields['found-'+id]) fields['found-'+id].value=found||'';
  }
  for (const [role,source] of Object.entries(draft.signatures||{})) {
    const pad=pads[role];
    if (!pad || !/^data:image\/png;base64,/.test(source)) continue;
    const image=new Image();
    image.onload=()=>{
      if (dailyDraftKey()!==key || pads[role]!==pad || pad.ink) return;
      pad.canvas=document.createElement('canvas');
      pad.canvas.width=image.naturalWidth;
      pad.canvas.height=image.naturalHeight;
      pad.canvas.getContext('2d').drawImage(image,0,0);
      pad.ink=true;
      pad.showConfirmed();
      refreshLaunchReviews();
    };
    image.src=source;
  }
  update();
  refreshLaunchReviews();
  draftStatus('Rascunho recuperado. Continue de onde parou.');
}
handover.addEventListener('input',event=>{
  handoverStarted??=Date.now();
  if (event.target.type!=='radio' && event.target.type!=='checkbox' && event.target.tagName!=='SELECT') saveDailyDraft();
});
handover.addEventListener('input',event=>{if(event.target.name?.startsWith('found-'))update();});
fields.vehicle.onchange=()=>{fields.coverage.checked=false;refreshOperatorChoices(true);byId('checks').replaceChildren();shown=[];buildPads([]);renderChecks();};
fields.coverage.onchange=()=>refreshOperatorChoices();
handover.addEventListener('change',event=>{if(event.target!==fields.vehicle){if(!event.target.name?.startsWith('note-'))buildPads([]);update();}});
handover.addEventListener('change',()=>{
  handoverStarted??=Date.now();
  saveDailyDraft();
});
handover.onsubmit=event=>{
  event.preventDefault();
  if (window.checklistCloud?.isEngineerPreview) return;
  const data=Object.fromEntries(new FormData(handover)), now=new Date().toISOString();
  const solo=fields.solo.checked;
  const outgoing=(data.outgoing||'').trim(), incoming=(data.incoming||'').trim();
  const operator=(data.operator||'').trim(), reason=(data.reason||'').trim();
  if(!solo&&(!outgoing||!incoming||outgoing.toLowerCase()===incoming.toLowerCase()))return alert('Informe dois operadores diferentes.');
  if(solo&&(!operator||!reason))return alert('Selecione quem fez o checklist e informe a justificativa.');
  if(!shown.length)return alert('Cadastre pelo menos um item para esta viatura.');
  if(Object.values(pads).some(pad=>!pad.ink))return alert('Colete as assinaturas antes de salvar.');
  const results=shown.map(({photo,general,...item})=>{
    const value=data['check-'+item.id], exception=isNonconforming(value);
    const found=exception ? (general ? 0 : Number(data['found-'+item.id])) : item.expected??null;
    return {...item,...(general ? {general:true} : {}),value,found,note:exception?data['note-'+item.id].trim():''};
  });
  if(results.some(item=>isNonconforming(item.value)&&!item.note))return alert('Informe o motivo de cada não conformidade.');
  const startedAt=handoverStarted??Date.now();
  const savedSignatures=padImages(pads);
  // Use the existing single-signer format so installations can sync with either server revision.
  const record={prefix:data.vehicle||window.checklistCloud?.vehicle||resumed?.prefix,outgoing:solo?operator:outgoing,incoming,operator,
    exchange:resumed?.exchange||new Date(startedAt).toISOString(),inspected:now,durationMs:Math.max(0,Date.parse(now)-startedAt),
    mode:solo?'absent':'normal',solo,missing:solo?'incoming':null,reason,prior:resumed?.id||null,results,km:data.km,fuel:data.fuel,
    signatures:solo?{outgoing:savedSignatures.operator}:savedSignatures,
    id:now+'-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2))};
  record.coverage=(solo?['operator']:['outgoing','incoming']).filter(role=>{
    const operator=operators().find(entry=>entry.name===record[role]);
    return operator&&!operator.vehicles.includes(record.prefix);
  });
  if(!save({...state,records:[record,...state.records]}))return;
  const draftKey=dailyDraftKey();
  if (draftKey) { try { localStorage.removeItem(draftKey); } catch {} }
  draftStatus('Preencha o próximo na passagem de turno.','Checklist concluído');
  handover.reset();handoverStarted=null;resumed=null;fields.vehicle.disabled=Boolean(window.checklistCloud?.vehicle);byId('resuming').hidden=true;
  shown=[];buildPads([]);refresh();renderChecks();page('historico');
  if(window.checklistCloud) window.checklistCloud.recordSaved('Checklist diário concluído e salvo');
  else byId('notice').textContent='Checklist diário concluído e salvo neste aparelho.';
};
function historyView() {
  refreshHistoryOptions('daily',state.records);
  const visible=state.records.map((record,index)=>({record,index})).filter(({record})=>historyIncludes(record,'daily'));
  byId('records').innerHTML=visible.length?visible.map(({record,index})=>{
    const done=state.records.some(other=>other.prior===record.id);
    const solo=isSoloChecklist(record);
    const status=solo?'Checklist sozinho':record.mode==='deferred'?(done?'Checklist registrado depois':'Aguardando checklist'):record.mode==='absent'?'Pendente de ciência':'Concluído';
    const people=solo?'Operador: '+escape(record.operator):'Entrega: '+escape(record.outgoing)+'<br>Recebe: '+escape(record.incoming);
    return '<details><summary>'+escape(record.prefix)+' · '+status+'<br><span class="muted">'+time(record.exchange)+'</span></summary><p>'+people+'</p>'+
      (record.inspected?'<p>Conferência: '+time(record.inspected)+' · '+escape(record.km)+' km · '+escape(record.fuel)+'</p>':'')+
      (record.coverage?.length?'<p>Operador substituto: '+record.coverage.map(role=>escape(record[role])).join(', ')+'</p>':'')+
      (record.reason?'<p>Justificativa: '+escape(record.reason)+'</p>':'')+
      (record.lateReason?'<p>Conferência após a troca · '+escape(record.lateReason)+'</p>':'')+
      (record.inspected?'<p>Tempo de conclusão: '+duration(record.durationMs)+'</p>':'')+
      (record.responsible?'<p>Responsável: '+escape(record.responsible)+'</p>':'')+
      (!solo&&record.missing?'<p>Ausente: '+(record.missing==='outgoing'?'quem entrega':'quem recebe')+'</p>':'')+
      (record.results.some(item=>item.critical&&isNonconforming(item.value))?'<p class="warning">Problema em item crítico</p>':'')+
      (record.results.length?'<ul>'+record.results.map(item=>'<li>'+escape(item.title)+' — '+escape(item.value)+(!item.general&&item.found!=null?' · '+escape(item.found)+(item.expected!=null?' de '+escape(item.expected):' encontrados'):'')+(item.note?' · '+escape(item.note):'')+'</li>').join('')+'</ul>':'')+
      Object.entries(record.signatures).map(([role,url])=>'<p>'+ (solo?'Operador':role==='outgoing'?'Quem entrega':'Quem recebe')+'<img class="record-image" alt="Assinatura registrada" src="'+escape(url)+'"></p>').join('')+
      (record.mode==='deferred'&&!done?'<button type="button" data-record="'+index+'">Fazer checklist agora</button>':'')+'</details>';
  }).join(''):'<article>Nenhuma passagem registrada.</article>';
  byId('records').querySelectorAll('button').forEach(button=>button.onclick=()=>{
    if(!confirm('Abrir a pendência? O formulário atual será substituído.'))return;
    resumed=state.records[Number(button.dataset.record)];
    handover.reset();handoverStarted=null;refresh();fields.vehicle.value=resumed.prefix;fields.vehicle.disabled=true;
    refreshOperatorChoices(true);
    byId('resuming').hidden=false;shown=[];buildPads([]);renderChecks();page('troca');
  });
}
refresh();renderChecks();
