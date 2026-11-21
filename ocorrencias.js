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
    window.checklistCloud?.schedule();
    byId('notice').textContent = 'Ocorrência salva neste aparelho.';
  } catch (failure) { alert(failure.message || 'Não foi possível salvar a ocorrência.'); }
  finally { button.disabled = false; }
};

async function refreshIncidentHistory() {
  const version = ++incidentHistoryRequest;
  const list = byId('incident-records');
  const allowed=window.checklistCloud?.canOpen('historico-ocorrencias')!==false;
  if(!allowed){list.replaceChildren();return;}
  try {
    const records = (await incidents()).reverse();
    if (version!==incidentHistoryRequest || window.checklistCloud?.canOpen('historico-ocorrencias')===false) return;
    const image = (src,alt) => '<img class="record-image" loading="lazy" src="'+escape(src)+'" alt="'+escape(alt)+'">';
    list.innerHTML = records.map(record=>'<details><summary>'+escape(record.prefix)+' · '+escape(record.impact)+'<br>'+
      '<span class="muted">'+time(record.at)+'</span></summary><p>Operador: '+escape(record.operator)+'</p>'+
      '<p>'+escape(record.description)+'</p>'+record.photos.map(src=>image(src,'Foto da ocorrência')).join('')+
      image(record.signatures.operator,'Assinatura do operador')+'</details>').join('') ||
      '<article>Nenhuma ocorrência registrada.</article>';
  } catch {
    if (version===incidentHistoryRequest) list.textContent = 'Não foi possível abrir as ocorrências.';
  }
}
resetIncident();
