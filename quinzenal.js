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
      request.onupgradeneeded = event => {
        if (event.oldVersion < 1) request.result.createObjectStore('inspections',{keyPath:'id'});
        if (event.oldVersion < 2) request.result.createObjectStore('incidents',{keyPath:'id'});
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = undefined; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
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

const historyDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'});
function historyIncludes(iso) {
  const day = historyDay.format(new Date(iso));
  const from = byId('history-from').value;
  const to = byId('history-to').value;
  return (!from || day>=from) && (!to || day<=to);
}

async function refreshFortnightHistory() {
  const version = ++historyRequest;
  const summary = byId('attendance-summary');
  const list = byId('fortnight-records');
  try {
    const records = (await inspections()).filter(record=>historyIncludes(record.at)).reverse();
    if (version !== historyRequest) return;
    const totals = new Map();
    let attended = 0;
    for (const record of records) {
      if (!record.attended) continue;
      attended++;
      const name = record.engineer.toLocaleLowerCase('pt-BR');
      const total = totals.get(name) || {name:record.engineer, count:0};
      total.count++;
      totals.set(name,total);
    }
    const percent = count => (count/records.length).toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1});
    summary.innerHTML = records.length
      ? '<p><strong>'+attended+' de '+records.length+'</strong> com acompanhamento ('+percent(attended)+').</p>'+
        [...totals.values()].map(total=>'<p>'+escape(total.name)+' · '+total.count+' de '+records.length+' ('+percent(total.count)+')</p>').join('')
      : '<p>Nenhuma vistoria no período.</p>';
    const image = (url,label) => '<img class="record-image" loading="lazy" src="'+escape(url)+'" alt="'+escape(label)+'">';
    list.innerHTML = records.map(record=>'<details><summary>'+escape(record.prefix)+' · '+time(record.at)+
      '</summary><p>Operador: '+escape(record.operator)+'</p><p>Acompanhamento: '+
      (record.attended ? escape(record.engineer) : 'Sem engenheiro')+
      '</p><p>Tempo de conclusão: '+duration(record.durationMs)+'</p>'+
      (record.notes ? '<p>'+escape(record.notes)+'</p>' : '')+
      Object.entries(record.photos).map(([key,photos])=>'<p>'+photoLabels[key]+'</p>'+
        photos.map(url=>image(url,photoLabels[key])).join('')).join('')+
      Object.entries(record.signatures).map(([role,url])=>{
        const label = role==='engineer'?'Assinatura do engenheiro':'Assinatura do operador';
        return '<p>'+label+'</p>'+image(url,label);
      }).join('')+'</details>').join('') || '<article>Nenhuma vistoria registrada no período.</article>';
  } catch {
    if (version !== historyRequest) return;
    summary.textContent = '';
    list.textContent = 'O navegador não conseguiu abrir o histórico das vistorias.';
  }
}

for (const id of ['history-from','history-to']) {
  byId(id).onchange = () => { if(historyKind==='daily') historyView(); else refreshFortnightHistory(); };
}
refreshFortnightPads();

function reportDuration(records) {
  const values = records.map(record=>record.durationMs).filter(Number.isFinite);
  return duration(values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null);
}

byId('prepare-report').onclick = async event => {
  if(window.checklistCloud?.canReport===false)return;
  const button = event.currentTarget;
  const kind = historyKind;
  button.disabled = true;
  try {
    const daily = state.records.filter(record=>historyIncludes(record.inspected||record.exchange));
    const fortnightly = (await inspections()).filter(record=>historyIncludes(record.at)).reverse();
    const attended = fortnightly.filter(record=>record.attended).length;
    const from = byId('history-from').value;
    const to = byId('history-to').value;
    const formattedDate = value => value.split('-').reverse().join('/');
    const period = [from?'De '+formattedDate(from):'',to?'Até '+formattedDate(to):''].filter(Boolean).join(' · ') || 'Todo o período disponível';
    const list = rows => rows.length ? '<ul>'+rows.map(row=>'<li>'+row+'</li>').join('')+'</ul>' : '<p>Sem registros.</p>';
    const dailyRows = daily.map(record=>{
      const discrepancies = (record.results||[]).filter(item=>item.found!=null && item.found!==item.expected);
      return '<strong>'+escape(record.prefix)+' · '+time(record.inspected||record.exchange)+'</strong><br>'+
        escape(record.outgoing)+' → '+escape(record.incoming)+' · '+duration(record.durationMs)+
        (record.reason?'<br>Ausência: '+escape(record.reason):'')+
        (record.lateReason?'<br>Atraso: '+escape(record.lateReason):'')+
        (discrepancies.length?'<br>Diferenças: '+discrepancies.map(item=>escape(item.title)+' ('+
          escape(item.found)+' de '+escape(item.expected)+')'+(item.note?' — '+escape(item.note):'')).join(', '):'');
    });
    const fortnightRows = fortnightly.map(record=>'<strong>'+escape(record.prefix)+' · '+time(record.at)+'</strong><br>'+
      escape(record.operator)+' · '+duration(record.durationMs)+' · '+(record.attended?escape(record.engineer):'Sem engenheiro'));
    const rate = fortnightly.length ? (attended/fortnightly.length).toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1}) : 'Sem vistorias';
    const content=kind==='daily'
      ? '<p>Trocas de turno: '+daily.length+' · Tempo médio: '+reportDuration(daily)+'</p><h2>Trocas de turno</h2>'+list(dailyRows)
      : '<p>Vistorias quinzenais: '+fortnightly.length+' · Tempo médio: '+reportDuration(fortnightly)+'</p>'+
        '<p>Acompanhamento do engenheiro: '+attended+' de '+fortnightly.length+' ('+rate+')</p>'+
        '<h2>Vistorias quinzenais</h2>'+list(fortnightRows);
    byId('report-content').innerHTML = '<h1>Relatório de Checklist de Viaturas DER</h1><p>'+escape(period)+'</p>'+content;
    byId('shell').hidden = true;
    byId('report-print').hidden = false;
    document.body.classList.add('reporting');
    byId('print-report').focus();
  } catch {
    byId('notice').textContent = 'Não foi possível preparar o relatório. Tente novamente.';
  } finally { button.disabled = false; }
};
byId('close-report').onclick = () => {
  byId('report-print').hidden = true;
  document.body.classList.remove('reporting');
  byId('shell').hidden = false;
  byId('prepare-report').focus();
};
byId('print-report').onclick = () => window.print();
