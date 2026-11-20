const fortnight = byId('fortnight-form');
const fortnightFields = fortnight.elements;
const photoLabels = {tires:'Pneus',cones:'Cones',tools:'Ferramental'};
let fortnightStarted = null;
let fortnightPads = {};
let historyRequest = 0;
let database;

function openInspectionStore() {
  if (!database) {
    database = new Promise((resolve,reject) => {
      const request = indexedDB.open('der-fortnightly-inspections'+(window.checklistCloud?.storageSuffix||''),2);
      let blocked = false;
      request.onupgradeneeded = event => {
        if (event.oldVersion < 1) request.result.createObjectStore('inspections',{keyPath:'id'});
        if (event.oldVersion < 2) request.result.createObjectStore('incidents',{keyPath:'id'});
      };
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); database = undefined; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Feche as outras abas antigas do Checklist e toque em Sincronizar.'));
      };
    }).catch(error => {
      database = undefined;
      throw error;
    });
  }
  return database;
}

async function evidenceRecords(name,record) {
  const db = await openInspectionStore();
  return new Promise((resolve,reject) => {
    const transaction = db.transaction(name,record?'readwrite':'readonly');
    const store = transaction.objectStore(name);
    const request = record ? store.put(record) : store.getAll();
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}
const inspections = record => evidenceRecords('inspections',record);

function refreshFortnightChoices() {
  const prefix = fortnightFields.vehicle.value;
  const operatorName = fortnightFields.operator.value;
  const available = state.vehicles.filter(vehicle => vehicle.active);
  fortnightFields.vehicle.innerHTML = option('','Selecione a viatura') +
    available.map(vehicle => option(vehicle.prefix,vehicle.prefix)).join('');
  fortnightFields.vehicle.value = available.some(vehicle=>vehicle.prefix===prefix)?prefix:'';
  if(window.checklistCloud?.vehicle)fortnightFields.vehicle.value=window.checklistCloud.vehicle;

  const current = fortnightFields.vehicle.value;
  const eligible = operators().filter(operator => current &&
    (fortnightFields.coverage.checked || operator.vehicles.includes(current)));
  fortnightFields.operator.innerHTML = option('','Selecione o operador') +
    eligible.map(operator => option(operator.name,operator.name +
      (operator.vehicles.includes(current)?'':' · Cobertura'))).join('');
  fortnightFields.operator.value = eligible.some(operator=>operator.name===operatorName)?operatorName:'';
}

function refreshFortnightPads() {
  const attendance = fortnightFields.attendance.value;
  byId('engineer-name').hidden = attendance !== 'yes';
  fortnightFields.engineer.required = attendance === 'yes';
  fortnightPads = signaturePads(byId('fortnight-pads'),
    attendance === 'yes' ? ['operator','engineer'] : ['operator']);
}

fortnight.addEventListener('input',() => { fortnightStarted ??= Date.now(); });
fortnightFields.vehicle.onchange = () => {
  fortnightFields.coverage.checked = false;
  refreshFortnightChoices();
  refreshFortnightPads();
};
fortnightFields.coverage.onchange = () => {
  refreshFortnightChoices();
  refreshFortnightPads();
};
for (const field of ['operator','attendance','engineer']) {
  fortnightFields[field].onchange = refreshFortnightPads;
}

fortnight.onsubmit = async event => {
  event.preventDefault();
  const button = byId('save-fortnight');
  if (button.disabled) return;
  const values = new FormData(fortnight);
  const attended = values.get('attendance') === 'yes';
  const engineer = attended ? values.get('engineer').trim() : '';
  if (attended && !engineer) return alert('Informe o nome do engenheiro.');
  if (Object.values(fortnightPads).some(pad=>!pad.ink)) return alert('Colete as assinaturas antes de salvar.');
  const groups = Object.keys(photoLabels).map(key => [key,[...fortnightFields[key].files]]);
  if (groups.some(([,files])=>files.length===0)) return alert('Inclua uma foto em cada categoria.');
  if (groups.some(([,files])=>files.length>12)) return alert('Selecione até 12 fotos por categoria.');
  const completedAt = Date.now();
  const storageSuffix = window.checklistCloud?.storageSuffix;
  const signatures = padImages(fortnightPads);
  button.disabled = true;
  try {
    const photos = {};
    for (const [key,files] of groups) {
      photos[key] = [];
      for (const file of files) photos[key].push(await preparePhoto(file));
    }
    const at = new Date(completedAt).toISOString();
    if (JSON.stringify(photos).length>7000000) throw new Error('Vistoria muito grande. Reduza a quantidade de fotos.');
    if (storageSuffix!==window.checklistCloud?.storageSuffix) throw Error('A sessão mudou. Reabra o formulário.');
    await inspections({
      id: at+'-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)), at, prefix: values.get('vehicle')||window.checklistCloud?.vehicle, operator: values.get('operator'),
      attended, engineer, notes: values.get('notes').trim(), signatures, photos,
      durationMs: Math.max(0,completedAt-(fortnightStarted??completedAt))
    });
    window.checklistCloud?.schedule();
    fortnight.reset();
    fortnightStarted = null;
    refreshFortnightChoices();
    refreshFortnightPads();
    page('historico-quinzenal');
    byId('notice').textContent = 'Vistoria quinzenal salva neste navegador.';
  } catch (error) {
    alert(error.message || 'Não foi possível salvar a vistoria. Tente novamente.');
  } finally {
    button.disabled = false;
  }
};

function duration(ms) {
  if (!Number.isFinite(ms)) return 'Não registrado';
  const seconds = Math.floor(ms/1000);
  return Math.floor(seconds/60)+' min '+(seconds%60)+' s';
}

async function refreshFortnightHistory() {
  const version = ++historyRequest;
  const list = byId('fortnight-records');
  try {
    const all = await inspections();
    if (version !== historyRequest || historyKind!=='fortnight') return;
    refreshHistoryOptions('fortnight',all);
    const records = all.filter(record=>historyIncludes(record,'fortnight')).reverse();
    const image = (url,label) => '<img class="record-image" loading="lazy" src="'+escape(url)+'" alt="'+escape(label)+'">';
    const canReport = window.checklistCloud?.canReport!==false;
    list.innerHTML = records.map((record,index)=>'<details><summary>'+escape(record.prefix)+' · '+time(record.at)+
      ' · '+escape(record.attended?record.engineer:'Sem engenheiro')+
      '</summary><p>Operador: '+escape(record.operator)+'</p><p>Acompanhamento: '+
      (record.attended ? escape(record.engineer) : 'Sem engenheiro')+
      '</p><p>Tempo de conclusão: '+duration(record.durationMs)+'</p>'+
      (record.notes ? '<p>'+escape(record.notes)+'</p>' : '')+
      (canReport?'<p><button type="button" data-fortnight-pdf="'+index+'">PDF desta vistoria</button></p>':'')+
      Object.entries(record.photos).map(([key,photos])=>'<p>'+photoLabels[key]+'</p>'+
        photos.map(url=>image(url,photoLabels[key])).join('')).join('')+
      Object.entries(record.signatures).map(([role,url])=>{
        const label = role==='engineer'?'Assinatura do engenheiro':'Assinatura do operador';
        return '<p>'+label+'</p>'+image(url,label);
      }).join('')+'</details>').join('') || '<article>Nenhuma vistoria registrada no período.</article>';
    for(const button of list.querySelectorAll('[data-fortnight-pdf]')) {
      button.onclick=()=>showIndividualFortnightReport(records[Number(button.dataset.fortnightPdf)],button);
    }
  } catch {
    if (version !== historyRequest) return;
    list.textContent = 'O navegador não conseguiu abrir o histórico das vistorias.';
  }
}

refreshFortnightPads();
