const incidentForm = byId('incident-form');
const incidentFields = incidentForm.elements;
const incidents = record => evidenceRecords('incidents',record);
let incidentPads = {};
let incidentHistoryRequest = 0;

function resetIncident() {
  incidentForm.reset();
  incidentPads = signaturePads(byId('incident-pads'),['operator']);
  refreshIncidentChoices();
}

function refreshIncidentChoices() {
  const previous = incidentFields.vehicle.value;
  const operatorName = incidentFields.operator.value;
  const vehicles = state.vehicles.filter(vehicle=>vehicle.active);
  const locked = window.checklistCloud?.vehicle;
  incidentFields.vehicle.disabled = Boolean(locked);
  incidentFields.vehicle.innerHTML = option('','Selecione a viatura')+
    vehicles.map(vehicle=>option(vehicle.prefix,vehicle.prefix)).join('');
  incidentFields.vehicle.value = locked || (vehicles.some(vehicle=>vehicle.prefix===previous)?previous:'');
  const prefix = incidentFields.vehicle.value;
  const eligible = operators().filter(operator=>prefix&&(incidentFields.coverage.checked||operator.vehicles.includes(prefix)));
  incidentFields.operator.innerHTML = option('','Selecione o operador')+
    eligible.map(operator=>option(operator.name,operator.name+(operator.vehicles.includes(prefix)?'':' · Substituto'))).join('');
  incidentFields.operator.value = eligible.some(operator=>operator.name===operatorName)?operatorName:'';
  incidentForm.hidden = window.checklistCloud?.canFileIncident===false;
}

incidentFields.vehicle.onchange = () => {
  incidentFields.coverage.checked = false;
  refreshIncidentChoices();
  incidentPads = signaturePads(byId('incident-pads'),['operator']);
};
incidentFields.coverage.onchange = refreshIncidentChoices;
incidentFields.operator.onchange = () => {
  incidentPads = signaturePads(byId('incident-pads'),['operator']);
};

incidentForm.onsubmit = async event => {
  event.preventDefault();
  if (window.checklistCloud?.canFileIncident===false) return;
  const button = byId('save-incident');
  if (button.disabled) return;
  const values = new FormData(incidentForm);
  const description = values.get('description').trim();
  const prefix = values.get('vehicle') || window.checklistCloud?.vehicle;
  if (!prefix || !description) return alert('Informe a viatura e descreva o que aconteceu.');
  if (!incidentPads.operator?.ink) return alert('Colete a assinatura do operador antes de salvar.');
  const files = [...incidentFields.photos.files];
  if (files.length>12) return alert('Selecione até 12 fotos.');
  const storageSuffix = window.checklistCloud?.storageSuffix;
  const signatures = padImages(incidentPads);
  button.disabled = true;
  try {
    const photos = [];
    for (const file of files) photos.push(await preparePhoto(file));
    if (JSON.stringify(photos).length>7000000) throw Error('As fotos estão muito grandes. Reduza a quantidade.');
    if (storageSuffix!==window.checklistCloud?.storageSuffix) throw Error('A sessão mudou. Reabra o formulário.');
    const at = new Date().toISOString();
    const id = at+'-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
    await incidents({id,at,prefix,operator:values.get('operator'),impact:values.get('impact'),
      description,photos,signatures});
    resetIncident();
    if(window.checklistCloud) window.checklistCloud.recordSaved('Ocorrência salva');
    else byId('notice').textContent = 'Ocorrência salva neste aparelho.';
  } catch (failure) { alert(failure.message || 'Não foi possível salvar a ocorrência.'); }
  finally { button.disabled = false; }
};

const incidentFilters = Object.fromEntries(['from','to','vehicle','operator','impact'].map(key=>[key,byId('incident-'+key)]));
const canReadIncidents = () => window.checklistCloud?.canOpen('historico-ocorrencias')!==false;
const canReportIncidents = () => canReadIncidents() && window.checklistCloud?.canReport!==false;
const incidentFilterValues = () => Object.fromEntries(Object.entries(incidentFilters).map(([key,input])=>[key,input.value]));
const incidentMatches = (record,filters) => historyIncludes(record,'incident',filters) && (!filters.impact || record.impact===filters.impact);

function resetIncidentHistoryFilters() {
  incidentHistoryRequest++;
  for (const input of Object.values(incidentFilters)) input.value = '';
  byId('clear-incident-filters').hidden = true;
  byId('incident-records').replaceChildren();
  byId('incident-count').textContent = '';
}

for (const input of Object.values(incidentFilters)) input.onchange = refreshIncidentHistory;
byId('clear-incident-filters').onclick = () => { resetIncidentHistoryFilters(); refreshIncidentHistory(); };

function incidentReportRecord(record,includePhotos) {
  const figure = (src,label) => '<figure><img src="'+escape(src)+'" alt="'+escape(label)+'"><figcaption>'+escape(label)+'</figcaption></figure>';
  const photoCount = record.photos?.length??0;
  return '<article class="report-record"><strong>'+escape(record.prefix)+' · '+time(record.at)+'</strong>'+
    '<p><b>Operador:</b> '+escape(record.operator)+' · <b>Situação:</b> '+escape(record.impact)+'</p>'+
    '<p><b>Descrição:</b> '+escape(record.description)+'</p><p>Fotos anexadas: '+photoCount+'</p></article>'+
    (includePhotos && photoCount?'<h2 class="report-section-title">Registro fotográfico</h2><div class="report-evidence">'+
      record.photos.map((photo,index)=>figure(photo,'Foto '+(index+1)+' da ocorrência')).join('')+'</div>':'')+
    (includePhotos && record.signatures?.operator?'<h2 class="report-section-title">Assinatura</h2>'+
      '<div class="report-evidence report-evidence-signatures">'+figure(record.signatures.operator,'Assinatura do operador')+'</div>':'');
}

byId('incident-report').onclick = async event => {
  if (!canReportIncidents()) return;
  const button = event.currentTarget;
  const filters = incidentFilterValues(), suffix = window.checklistCloud?.storageSuffix;
  button.disabled = true;
  try {
    const records = (await incidents()).sort((a,b)=>b.at.localeCompare(a.at)).filter(record=>incidentMatches(record,filters));
    if (suffix!==window.checklistCloud?.storageSuffix || !canReportIncidents()) return;
    const date = value => value.split('-').reverse().join('/');
    const period = [filters.from?'De '+date(filters.from):'',filters.to?'Até '+date(filters.to):''].filter(Boolean).join(' · ');
    openReport('Relatório de ocorrências no turno',[
      ['Período',period||'Todo o período disponível'],['Viatura',filters.vehicle||'Todas'],
      ['Operador',filters.operator||'Todos'],['Situação',filters.impact||'Todas']
    ],'<h2 class="report-section-title">Ocorrências selecionadas · '+records.length+'</h2>'+
      (records.length?records.map(record=>incidentReportRecord(record,false)).join(''):'<p>Nenhuma ocorrência nos filtros selecionados.</p>'),
      button,'Filtros aplicados');
  } catch {
    byId('notice').textContent = 'Não foi possível preparar o relatório de ocorrências.';
  } finally { button.disabled = false; }
};

async function refreshIncidentHistory() {
  const version = ++incidentHistoryRequest;
  const list = byId('incident-records');
  const allowed=canReadIncidents();
  if(!allowed){list.replaceChildren();return;}
  try {
    const all = (await incidents()).sort((a,b)=>b.at.localeCompare(a.at));
    if (version!==incidentHistoryRequest || !canReadIncidents()) return;
    const filters = incidentFilterValues();
    for (const [key,field,label] of [['vehicle','prefix','Todas as viaturas'],['operator','operator','Todos os operadores']]) {
      const values = [...new Set([filters[key],...all.map(record=>record[field])].filter(Boolean))].sort(historyOrder.compare);
      incidentFilters[key].replaceChildren(new Option(label,''),...values.map(value=>new Option(value,value)));
      incidentFilters[key].value = filters[key];
    }
    const records = all.filter(record=>incidentMatches(record,filters));
    byId('clear-incident-filters').hidden = !Object.values(filters).some(Boolean);
    byId('incident-count').textContent = records.length+(records.length===1?' ocorrência':' ocorrências')+' nos filtros selecionados';
    const canReport = canReportIncidents();
    byId('incident-report').hidden = !canReport;
    const image = (src,alt) => '<img class="record-image" loading="lazy" src="'+escape(src)+'" alt="'+escape(alt)+'">';
    list.innerHTML = records.map((record,index)=>'<details><summary>'+escape(record.prefix)+' · '+escape(record.impact)+'<br>'+
      '<span class="muted">'+time(record.at)+'</span></summary><p>Operador: '+escape(record.operator)+'</p>'+
      '<p>'+escape(record.description)+'</p><div class="actions">'+
      (canReport?'<button type="button" data-incident-pdf="'+index+'">PDF desta ocorrência</button>':'')+
      (window.checklistCloud?.canDeleteIncident && record.cloudSaved?'<button type="button" class="delete-button" data-incident-delete="'+index+'">Excluir ocorrência</button>':'')+
      '</div>'+record.photos.map(src=>image(src,'Foto da ocorrência')).join('')+
      image(record.signatures.operator,'Assinatura do operador')+'</details>').join('') ||
      '<article>Nenhuma ocorrência nos filtros selecionados.</article>';
    for (const button of list.querySelectorAll('[data-incident-pdf]')) button.onclick = () => {
      const record = records[Number(button.dataset.incidentPdf)];
      if (canReportIncidents()) openReport('Ocorrência no turno · Registro individual',
        [['Viatura',record.prefix],['Data e hora',time(record.at)]],incidentReportRecord(record,true),button,'Dados da ocorrência');
    };
    for (const button of list.querySelectorAll('[data-incident-delete]')) button.onclick = async () => {
      const record = records[Number(button.dataset.incidentDelete)];
      if (!confirm('Excluir a ocorrência de '+record.prefix+' de '+time(record.at)+' do histórico e dos relatórios?')) return;
      button.disabled = true;
      try {
        await window.checklistCloud.deleteIncident(record);
        await refreshIncidentHistory();
        byId('notice').textContent = 'Ocorrência excluída do histórico e dos relatórios.';
      } catch (error) { alert(error.message || 'Não foi possível excluir a ocorrência.'); }
      finally { button.disabled = false; }
    };
  } catch {
    if (version===incidentHistoryRequest) list.textContent = 'Não foi possível abrir as ocorrências.';
  }
}
resetIncident();
