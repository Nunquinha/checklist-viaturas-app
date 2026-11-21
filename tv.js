'use strict';

function nonconformityHistory(records) {
  const open = new Map();
  const resolved = [];
  for (const record of [...records].sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id))) {
    const seen = new Set();
    for (const item of record.results) {
      const identity = item.id || String(item.title || '').trim().toLocaleLowerCase('pt-BR');
      if (!identity) continue;
      const key = JSON.stringify([record.prefix,identity]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.value==='Conforme' || item.value==='OK') {
        const prior = open.get(key);
        if (prior) resolved.push({...prior,closed:record.at});
        open.delete(key);
      } else if (item.value==='Não Conforme' || item.value==='Problema') {
        const prior = open.get(key);
        open.set(key,{...item,prefix:record.prefix,first:prior?.first ?? record.at,
          last:record.at,count:(prior?.count ?? 0)+1});
      }
    }
  }
  return {pending:[...open.values()].sort((a,b)=>Number(Boolean(b.critical))-Number(Boolean(a.critical)) ||
    a.first-b.first || a.prefix.localeCompare(b.prefix,'pt-BR')),resolved:resolved.reverse()};
}

const openNonconformities = records => nonconformityHistory(records).pending;
const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const shortage = item => Number.isFinite(item.expected) && Number.isFinite(item.found) && item.found<item.expected
  ? item.expected-item.found : 0;

function materialsToReplace(pending) {
  const materials = new Map();
  for (const item of pending) {
    const amount = shortage(item);
    if (!amount) continue;
    const key = item.id || normalize(item.title).trim();
    const material = materials.get(key) || {title:item.title || 'Item sem nome',total:0,vehicles:[],at:0};
    if (item.last>=material.at) {
      material.title = item.title || material.title;
      material.at = item.last;
    }
    material.total += amount;
    material.vehicles.push({prefix:item.prefix,amount});
    materials.set(key,material);
  }
  return [...materials.values()].sort((a,b)=>b.total-a.total || a.title.localeCompare(b.title,'pt-BR'));
}

function shiftMileage(records, since) {
  const previous = new Map(), totals = new Map();
  let skipped = 0;
  for (const record of [...records].sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id))) {
    if (record.solo || record.prior || ![undefined,'normal','deferred','absent'].includes(record.mode)) continue;
    const before = previous.get(record.prefix);
    const raw = record.mode==='deferred' || record.mode==='absent' ? null : record.km;
    const number = typeof raw==='number' || (typeof raw==='string' && raw.trim()) ? Number(raw) : NaN;
    const valid = Number.isSafeInteger(number) && number>=0;
    previous.set(record.prefix,valid?number:null);
    if (record.at<since || before===undefined) continue;
    if (!valid || before===null || number<before) {
      skipped++;
      continue;
    }
    const summary = totals.get(record.prefix) || {prefix:record.prefix,total:0,count:0};
    const delta = number-before;
    totals.set(record.prefix,{...summary,total:summary.total+delta,count:summary.count+1,last:delta});
  }
  return {totals:[...totals.values()].sort((a,b)=>b.total-a.total || a.prefix.localeCompare(b.prefix,'pt-BR')),skipped};
}

function demonstrationRecords(now) {
  const cones = found => ({id:'cones',title:'Cones',expected:20,found,value:found===20?'Conforme':'Não Conforme',
    note:found===20?'':'Cones danificados foram retirados da viatura.'});
  const signal = working => ({id:'signal',title:'Barra sinalizadora',critical:true,value:working?'Conforme':'Não Conforme',
    note:working?'':'O módulo do lado esquerdo não acende.'});
  const flashlight = {id:'light',title:'Lanterna de inspeção',value:'Não Conforme',note:'Bateria não mantém carga.'};
  const row = (prefix,hours,km,...results) => {
    const at = now-hours*3600000;
    return {id:prefix+'-'+at,prefix,at,km,mode:'normal',results};
  };
  return [
    row('DEMO-101',96,8100,signal(true),cones(20)), row('DEMO-101',72,8165,signal(false),cones(20)),
    row('DEMO-101',48,8240,signal(false),cones(20)), row('DEMO-101',24,8290,signal(false),cones(20)),
    row('DEMO-101',4,8320,signal(false),cones(20)),
    row('DEMO-204',32,12040,cones(20),signal(true)), row('DEMO-204',2,12110,cones(17),signal(true)),
    row('DEMO-308',31,6350,cones(19)), row('DEMO-308',6,6405,cones(20),flashlight),
    row('DEMO-407',21,9050,cones(20)), row('DEMO-407',1,9120,cones(18))
  ];
}

function derPdf(Pdf, {logo, now, demo, date}, title, summary) {
  const doc = new Pdf({format:'a4',unit:'mm',compress:true});
  const font = (size, bold=false, color='#26382e')=>{
    doc.setFont('helvetica',bold?'bold':'normal');
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  const header = () => {
    doc.addImage(logo,'JPEG',15,12,21,16,'der');
    font(9,true,'#52655a');
    doc.text('DER · CGR.02 | CHECKLIST DE VIATURAS',42,16);
    font(18,true);
    doc.text(title,42,25);
    doc.setFillColor('#f4db00');
    doc.rect(15,32,180,1.2,'F');
    font(9,false,'#52655a');
    doc.text('Emitido em '+date(now)+' · Horário de Brasília',15,40);
    doc.text(summary,15,46);
    if (demo) {
      font(9,true,'#8a4b16');
      doc.text('DEMONSTRAÇÃO · REGISTROS FICTÍCIOS',15,52);
    }
  };
  const finish = () => {
    const pages = doc.getNumberOfPages();
    for (let page=1;page<=pages;page++) {
      doc.setPage(page);
      doc.setDrawColor('#dfe5df');
      doc.line(15,283,195,283);
      font(8,false,'#52655a');
      doc.text('Fonte: Checklist Diário · Desenvolvido por Vinicius Vaz Vieira',15,288);
      doc.text(page+' / '+pages,195,288,{align:'right'});
    }
    return doc;
  };
  return {doc,font,header,finish};
}

function nonconformityPdf(Pdf, pending, options) {
  const {now,date} = options;
  const grouped = new Map();
  for (const item of pending) {
    if (!grouped.has(item.prefix)) grouped.set(item.prefix,[]);
    grouped.get(item.prefix).push(item);
  }
  const {doc,font,header,finish} = derPdf(Pdf,options,'Relatório de não conformidades',
    grouped.size+' viaturas com pendências · '+pending.length+' itens em aberto · '+
    pending.filter(item=>item.critical).length+' críticos');
  const vehicle = (prefix,y,continuation=false)=>{
    doc.setFillColor('#e9eee9');
    doc.rect(15,y,180,8,'F');
    font(11,true);
    doc.text(prefix+(continuation?' (continuação)':''),18,y+5.4);
    return y+12;
  };
  let y = 58;
  header();
  for (const [prefix,items] of grouped) {
    let first = true;
    for (const item of items) {
      font(11,true);
      const title = doc.splitTextToSize((item.title || 'Item sem nome')+(item.critical?' · Crítico':''),172);
      font(9);
      const count = item.count===1?'Primeiro registro':item.count+' checklists seguidos';
      const age = elapsedTime(now-item.first);
      const dates = 'Em aberto há '+age+' · Desde '+date(item.first)+' · Último registro '+date(item.last);
      const amount = item.found!=null
        ? ' · '+(item.expected==null?item.found+' encontrados':item.found+' de '+item.expected+' exigidos')
        : '';
      const notes = doc.splitTextToSize('Justificativa: '+(item.note || 'Sem justificativa no registro'),172);
      const height = 8+title.length*4.6+(notes.length+2)*4;
      if (y+height+(first?12:0)>278) {
        doc.addPage();
        header();
        y = 58;
        if (!first) y = vehicle(prefix,y,true);
      }
      if (first) { y = vehicle(prefix,y); first = false; }
      font(11,true,item.critical?'#8e302a':'#26382e');
      doc.text(title,19,y);
      y += title.length*4.6;
      font(9);
      doc.text(dates,19,y);
      doc.text(count+amount+(shortage(item)?' · '+shortage(item)+' a repor':''),19,y+4);
      doc.text(notes,19,y+8,{lineHeightFactor:1.26});
      y += (notes.length+2)*4+3;
      doc.setDrawColor('#dfe5df');
      doc.line(19,y-2,191,y-2);
      y += 5;
    }
  }
  return finish();
}

const kilometers = totals => totals.reduce((sum,entry)=>sum+entry.total,0);
const bases = [['1','Itapetininga'],['2','Capão Bonito'],['4','Itapeva'],['5','Sorocaba'],['8','Tatuí']];
const firstPrefixDigit = prefix => String(prefix ?? '').match(/\d/)?.[0];

function mileagePdf(Pdf, {totals,skipped,label}, options) {
  const {doc,font,header,finish} = derPdf(Pdf,options,'Resumo de quilometragem da frota',
    'Período: '+label+ (options.base?' · Base: '+options.base:''));
  const number = new Intl.NumberFormat('pt-BR');
  const km = value => number.format(value)+' km';
  const count = totals.reduce((sum,entry)=>sum+entry.count,0);
  const tableHeader = () => {
    doc.setFillColor('#e9eee9');
    doc.rect(15,82,180,9,'F');
    font(9,true);
    doc.text('Viatura',19,88);
    doc.text('Total rodado',98,88,{align:'right'});
    doc.text('Intervalos entre trocas',147,88,{align:'right'});
    doc.text('Km desde a troca anterior',191,88,{align:'right'});
  };
  const startPage = () => {
    header();
    doc.setFillColor('#f1f5f1');
    doc.roundedRect(15,57,180,19,2,2,'F');
    font(15,true);
    doc.text(km(kilometers(totals)),19,65);
    font(8,false,'#52655a');
    doc.text('TOTAL RODADO PELA FROTA',19,71);
    font(10,true);
    doc.text(totals.length+' viaturas · '+count+' intervalos entre trocas',191,67,{align:'right'});
    tableHeader();
  };
  let y = 97;
  startPage();
  for (const [index,entry] of totals.entries()) {
    if (y>258) { doc.addPage(); startPage(); y = 97; }
    if (index%2) {
      doc.setFillColor('#f7f9f7');
      doc.rect(15,y-5,180,8,'F');
    }
    font(10,true);
    doc.text(entry.prefix,19,y);
    doc.text(km(entry.total),98,y,{align:'right'});
    font(9);
    doc.text(number.format(entry.count),147,y,{align:'right'});
    doc.text(km(entry.last),191,y,{align:'right'});
    y += 8;
  }
  font(8,false,'#52655a');
  doc.text('Diferenças entre odômetros de trocas consecutivas, atribuídas à data da última leitura.',15,y+4);
  if (skipped) doc.text('Trechos excluídos por leituras ausentes ou inválidas: '+number.format(skipped)+'.',15,y+9);
  return finish();
}

function elapsedTime(ms) {
  const minutes = Math.max(0,Math.floor(ms/60000));
  if (minutes<60) return minutes+' min';
  const hours = Math.floor(minutes/60);
  const days = Math.floor(hours/24);
  return days ? days+(days===1?' dia':' dias') : hours+' h';
}

if (typeof module!=='undefined') module.exports = {openNonconformities,nonconformityHistory,materialsToReplace,
  shiftMileage,demonstrationRecords,nonconformityPdf,mileagePdf};
if (typeof document!=='undefined') startPanel();

function startPanel() {
  const get = id => document.getElementById(id);
  const sessionKey = 'checklist-cloud-session-v1';
  const endpoint = document.querySelector('meta[name="checklist-endpoint"]').content;
  const demo = new URLSearchParams(location.search).get('demo')==='1';
  const zone = 'America/Sao_Paulo';
  const date = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:zone});
  const clock = new Intl.DateTimeFormat('pt-BR',{timeStyle:'medium',timeZone:zone});
  const number = new Intl.NumberFormat('pt-BR');
  const pageSize = 12;
  let sessionToken, accessScope, checkpoint, refreshing = false, syncedAt = null;
  let records = new Map(), latest = new Map(), pending = [], resolved = [], page = 0;
  const requestForm = get('request-code'), verifyForm = get('verify-code');
  const permitted = user => ['owner','manager','viewer','engineer'].includes(user?.role);
  const search = get('search'), filter = get('filter'), vehicleDialog = get('vehicle-dialog');
  const kmBase = get('km-base');
  const pendingBase = get('pending-base'), trendBase = get('trend-base');
  for (const select of [kmBase,pendingBase,trendBase]) {
    for (const [code,name] of bases) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      select.append(option);
    }
  }
  let email;

  function session() {
    try {
      const value = JSON.parse(localStorage.getItem(sessionKey));
      return value?.expires>Date.now() && value.token ? value : null;
    } catch {
      return null;
    }
  }

  async function rpc(token, action, body = {}) {
    const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},
      credentials:'omit',cache:'no-store',body:JSON.stringify({action,body,token}),signal:AbortSignal.timeout(40000)});
    if (!response.ok) throw Error('Serviço temporariamente indisponível.');
    const result = await response.json();
    if (!result.ok) throw Error(result.error || 'Resposta inválida.');
    return result.data;
  }

  function hideData(message, action) {
    records = new Map();
    latest = new Map();
    pending = [];
    resolved = [];
    checkpoint = null;
    syncedAt = null;
    page = 0;
    get('rows').replaceChildren();
    get('material-rows').replaceChildren();
    get('resolved-rows').replaceChildren();
    get('vehicle-results').replaceChildren();
    get('vehicle-title').textContent = '';
    get('vehicle-summary').textContent = '';
    if (vehicleDialog.open) vehicleDialog.close();
    get('refresh-now').hidden = true;
    ['affected','pending','critical'].forEach(id=>get(id).textContent='');
    get('dashboard').hidden = true;
    get('gate-message').textContent = message;
    get('gate').hidden = false;
    requestForm.hidden = action!=='login' || Boolean(email);
    verifyForm.hidden = action!=='login' || !email;
    get('retry').hidden = action!=='retry';
  }

  const elapsed = elapsedTime;

  function addText(parent, tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    parent.append(element);
  }

  function vehicleButton(prefix) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vehicle-link';
    button.textContent = prefix;
    button.setAttribute('aria-label','Abrir último checklist da viatura '+prefix);
    button.onclick = () => showVehicle(prefix);
    return button;
  }

  function renderMaterials() {
    const query = normalize(get('material-search').value.trim());
    const materials = materialsToReplace(pending).filter(item=>!query || normalize(item.title).includes(query) ||
      item.vehicles.some(vehicle=>normalize(vehicle.prefix).includes(query)));
    const rows = document.createDocumentFragment();
    for (const material of materials) {
      const row = rows.appendChild(document.createElement('tr'));
      addText(row.insertCell(),'strong',material.title);
      addText(row.insertCell(),'strong',number.format(material.total),'age');
      const vehicles = row.insertCell();
      vehicles.className = 'material-vehicles';
      for (const {prefix,amount} of material.vehicles) {
        const button = vehicleButton(prefix);
        button.textContent = prefix+' · '+number.format(amount);
        button.setAttribute('aria-label',prefix+', '+amount+' a repor. Abrir último checklist.');
        vehicles.append(button);
      }
    }
    get('material-rows').replaceChildren(rows);
    get('material-table').hidden = !materials.length;
    get('material-summary').textContent = materials.length
      ? materials.length+(materials.length===1?' material com reposição pendente':' materiais com reposição pendente')
      : 'Nenhum material a repor para essa busca.';
  }

  function renderResolved() {
    const days = Number(get('resolved-period').value);
    const cutoff = days ? Date.now()-days*86400000 : 0;
    const query = normalize(get('resolved-search').value.trim());
    const matches = resolved.filter(item=>item.closed>=cutoff && (!query ||
      [item.prefix,item.title].some(value=>normalize(value).includes(query))));
    const durations = matches.map(item=>item.closed-item.first).sort((a,b)=>a-b);
    const middle = Math.floor(durations.length/2);
    const median = durations.length%2 ? durations[middle] : (durations[middle-1]+durations[middle])/2;
    const rows = document.createDocumentFragment();
    for (const item of matches.slice(0,12)) {
      const row = rows.appendChild(document.createElement('tr'));
      row.insertCell().append(vehicleButton(item.prefix));
      addText(row.insertCell(),'strong',item.title || 'Item sem nome');
      addText(row.insertCell(),'time',date.format(item.closed));
      addText(row.insertCell(),'span',elapsed(item.closed-item.first));
    }
    get('resolved-rows').replaceChildren(rows);
    get('resolved-table').hidden = !matches.length;
    get('resolved-summary').textContent = matches.length
      ? matches.length+(matches.length===1?' resolvida':' resolvidas')+' · Tempo mediano: '+elapsed(median)+
        (matches.length>12?' · 12 mais recentes abaixo':'')
      : 'Nenhuma resolução para estes filtros.';
  }

  function mileagePeriod(period, now, base = kmBase.value) {
    const month = new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now).slice(0,7);
    const days = Number(period);
    const since = period==='month'?Date.parse(month+'-01T00:00:00-03:00'):days?now-days*86400000:0;
    const calendar = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:zone});
    const label = since?calendar.format(since)+' a '+calendar.format(now):'Todo o histórico até '+calendar.format(now);
    const selected = base ? [...records.values()].filter(record=>firstPrefixDigit(record.prefix)===base) : records.values();
    return {...shiftMileage(selected,since),label};
  }

  function renderMileage() {
    const period = get('km-period').value;
    const now = Date.now();
    const monthly = mileagePeriod('month',now,'');
    get('km-month').textContent = monthly.totals.length ? number.format(kilometers(monthly.totals))+' km' : '—';
    const {totals,skipped} = period==='month' && !kmBase.value ? monthly : mileagePeriod(period,now);
    get('download-km-pdf').disabled = totals.length===0;
    const rows = document.createDocumentFragment();
    for (const entry of totals) {
      const row = rows.appendChild(document.createElement('tr'));
      row.insertCell().append(vehicleButton(entry.prefix));
      addText(row.insertCell(),'strong',number.format(entry.total)+' km');
      addText(row.insertCell(),'span',entry.count);
      addText(row.insertCell(),'span',number.format(entry.last)+' km');
    }
    get('km-rows').replaceChildren(rows);
    get('km-table').hidden = totals.length===0;
    get('km-total').textContent = totals.length ? number.format(kilometers(totals))+' km no período'
      : 'Sem trechos calculáveis no período';
    get('km-note').textContent = 'Diferença entre odômetros consecutivos da mesma viatura, atribuída à data da última leitura.'+
      (skipped?' '+skipped+' '+(skipped===1?'trecho sem leituras válidas':'trechos sem leituras válidas')+'.':'');
  }

  function renderRows() {
    const query = normalize(search.value.trim());
    const visible = pending.filter(item=>{
      if (pendingBase.value && firstPrefixDigit(item.prefix)!==pendingBase.value) return false;
      if (filter.value==='critical' && !item.critical) return false;
      if (filter.value==='repeated' && item.count<2) return false;
      if (filter.value==='shortage' && !shortage(item)) return false;
      return !query || [item.prefix,item.title,item.note].some(value=>normalize(value).includes(query));
    });
    const pages = Math.max(1,Math.ceil(visible.length/pageSize));
    page = (page%pages+pages)%pages;
    const rows = document.createDocumentFragment();
    for (const item of visible.slice(page*pageSize,(page+1)*pageSize)) {
      const row = rows.appendChild(document.createElement('tr'));
      row.insertCell().append(vehicleButton(item.prefix));
      const details = row.insertCell();
      addText(details,'strong',item.title || 'Item sem nome');
      if (item.critical) addText(details,'span','Crítico','badge critical');
      if (item.found!=null) addText(details,'span',item.expected==null
        ? 'Quantidade encontrada: '+item.found
        : item.found+' de '+item.expected+' exigidos','line');
      if (shortage(item)) addText(details,'span',shortage(item)+' a repor','line age');
      addText(details,'span',item.note || 'Registro sem justificativa','line');
      const first = row.insertCell();
      addText(first,'span',Date.now()-item.first<60000?'Agora':'Há '+elapsed(Date.now()-item.first),'age');
      addText(first,'time',date.format(item.first),'line');
      const repetition = row.insertCell();
      if (item.count>1) {
        addText(repetition,'strong',item.count+' checklists seguidos','repeat');
        addText(repetition,'span','Último: '+date.format(item.last),'line');
      } else {
        addText(repetition,'span','Primeiro registro');
      }
    }
    get('rows').replaceChildren(rows);
    get('pagination').hidden = pages===1;
    get('pager').textContent = (page+1)+' / '+pages;
    get('result-count').textContent = visible.length===pending.length ? '' : '('+visible.length+' de '+pending.length+')';
    get('table').hidden = visible.length===0;
    get('empty').hidden = visible.length>0;
    get('empty').textContent = pending.length ? 'Nenhuma pendência corresponde aos filtros.'
      : records.size ? 'Nenhuma não conformidade em aberto.' : 'Nenhum checklist diário disponível para este acesso.';
  }

  function renderOverview() {
    const baseRows = document.createDocumentFragment();
    for (const [code,name] of bases) {
      const open = pending.filter(item=>firstPrefixDigit(item.prefix)===code);
      const critical = open.filter(item=>item.critical);
      const row = baseRows.appendChild(document.createElement('tr'));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'vehicle-link';
      button.textContent = name;
      button.onclick = () => {
        pendingBase.value = code;
        search.value = '';
        filter.value = 'all';
        updateFilters();
        const tab = get('tab-pending-section');
        activateTab(tab);
        tab.focus();
      };
      row.insertCell().append(button);
      addText(row.insertCell(),'strong',open.length);
      addText(row.insertCell(),'strong',critical.length,critical.length?'critical':'');
      addText(row.insertCell(),'span',critical.length?elapsed(Date.now()-critical[0].first):'—');
    }
    get('base-rows').replaceChildren(baseRows);
    const week = 7*86400000, offset = 3*3600000;
    const today = new Date(Date.now()-offset);
    const monday = Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-(today.getUTCDay()+6)%7)+offset;
    const calendar = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:zone});
    const rows = document.createDocumentFragment();
    const inBase = item => !trendBase.value || firstPrefixDigit(item.prefix)===trendBase.value;
    const opened = [...pending,...resolved].filter(inBase);
    const closed = resolved.filter(inBase);
    for (let index=0;index<4;index++) {
      const from = monday-index*week, to = from+week;
      const added = opened.filter(item=>item.first>=from && item.first<to).length;
      const done = closed.filter(item=>item.closed>=from && item.closed<to).length;
      const row = rows.appendChild(document.createElement('tr'));
      addText(row.insertCell(),'span',calendar.format(from)+(index===0?' · Semana atual':''));
      addText(row.insertCell(),'strong',added);
      addText(row.insertCell(),'strong',done);
      addText(row.insertCell(),'strong',(added>done?'+':'')+(added-done));
    }
    get('trend-rows').replaceChildren(rows);
  }

  function showVehicle(prefix) {
    const record = latest.get(prefix);
    if (!record) return;
    const failed = item => ['Não Conforme','Problema'].includes(item.value);
    get('vehicle-title').textContent = prefix;
    const failures = record.results.filter(failed).length;
    get('vehicle-summary').textContent = date.format(record.at)+' · '+record.results.length+' itens conferidos · '+
      failures+' '+(failures===1?'não conformidade':'não conformidades')+
      (String(record.km ?? '').trim() && Number.isSafeInteger(Number(record.km)) ? ' · Odômetro '+number.format(Number(record.km))+' km' : '');
    const rows = document.createDocumentFragment();
    for (const item of [...record.results].sort((a,b)=>Number(failed(b))-Number(failed(a)))) {
      const entry = rows.appendChild(document.createElement('li'));
      addText(entry,'strong',item.title || 'Item sem nome');
      const value = failed(item)?'Não conforme':item.value==='OK'?'Conforme':item.value;
      addText(entry,'span',value || 'Sem resultado',failed(item)?'line critical':'line');
      if (item.found!=null) addText(entry,'span',item.expected==null ? 'Quantidade encontrada: '+item.found
        : item.found+' de '+item.expected+' exigidos','line');
      if (shortage(item)) addText(entry,'span',shortage(item)+' a repor','line age');
      if (item.note) addText(entry,'span',item.note,'line');
    }
    get('vehicle-results').replaceChildren(rows);
    if (!vehicleDialog.open) vehicleDialog.showModal();
  }

  function render() {
    get('download-pdf').disabled = pending.length===0;
    get('affected').textContent = new Set(pending.map(item=>item.prefix)).size;
    get('pending').textContent = pending.length;
    get('critical').textContent = pending.filter(item=>item.critical).length;
    get('dashboard').hidden = false;
    get('gate').hidden = true;
    get('refresh-now').hidden = demo;
    if (!vehicleDialog.open) {
      renderRows();
      renderMaterials();
      renderResolved();
      renderMileage();
      renderOverview();
    }
  }

  function status(message,stale = false) {
    get('sync-state').textContent = message;
    get('sync-state').classList.toggle('stale',stale);
  }

  function loadRecords(nextRecords) {
    ({pending,resolved} = nonconformityHistory(nextRecords.values()));
    latest = new Map();
    for (const record of nextRecords.values()) {
      const prior = latest.get(record.prefix);
      if (record.mode!=='deferred' && (!prior || record.at>prior.at || (record.at===prior.at && record.id>prior.id))) latest.set(record.prefix,record);
    }
    records = nextRecords;
  }

  async function refresh() {
    if (refreshing) return;
    const active = session();
    if (!active) {
      status('Painel com acesso restrito');
      hideData('Entre com seu e-mail autorizado para ver a situação da frota.','login');
      return;
    }
    refreshing = true;
    get('refresh-now').disabled = true;
    try {
      if (sessionToken!==active.token) {
        hideData('Validando a sessão do Checklist DER.');
        sessionToken = active.token;
        accessScope = null;
      }
      const user = await rpc(active.token,'me');
      if (!permitted(user)) {
        status('Painel com acesso restrito');
        hideData('Entre com uma conta autorizada a consultar o painel.','login');
        return;
      }
      const scope = JSON.stringify([user.role,user.prefix]);
      if (accessScope!==scope) {
        hideData('Carregando os registros disponíveis para este acesso.');
        accessScope = scope;
      }
      if (!syncedAt) status('Lendo o histórico do Checklist Diário…');
      let cursor = null, head;
      const nextRecords = new Map(records);
      do {
        const batch = await rpc(active.token,'listRecords',{cursor,checkpoint:checkpoint ?? null});
        if (session()?.token!==active.token) return;
        head ??= batch.records[0]?.record.id;
        for (const {kind,record} of batch.records) {
          if (kind!=='daily' || !Array.isArray(record.results)) continue;
          const at = Date.parse(record.inspected || record.exchange || record.at);
          if (!Number.isFinite(at)) continue;
          const results = record.results.map(({id,title,critical,value,expected,found,note})=>
            ({id,title,critical,value,expected,found,note}));
          nextRecords.set(record.id,{id:record.id,prefix:record.prefix,at,results,mode:record.mode,solo:record.solo,prior:record.prior,km:record.km});
        }
        cursor = batch.cursor;
      } while (cursor>0);
      loadRecords(nextRecords);
      checkpoint = head ?? checkpoint;
      syncedAt = Date.now();
      status('Atualizado às '+clock.format(syncedAt)+' · atualização automática a cada 60 s');
      render();
    } catch (error) {
      if (/acesso|sessão|token|entre novamente/i.test(error.message)) {
        status('Sessão indisponível',true);
        hideData('Entre novamente para acessar o painel.','login');
      } else {
        status(syncedAt?'Sem atualização · últimos dados recebidos às '+clock.format(syncedAt):'Não foi possível consultar a base.',true);
        if (!syncedAt) hideData('Confira a conexão e tente atualizar o painel.','retry');
      }
    } finally {
      refreshing = false;
      get('refresh-now').disabled = false;
    }
  }

  function submit(form, action) {
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      try { await action(new FormData(form)); }
      catch (error) { get('gate-message').textContent = error.message || 'Não foi possível entrar.'; }
      finally { button.disabled = false; }
    };
  }
  submit(requestForm,async data=>{
    const address = data.get('email').trim().toLowerCase();
    await rpc(null,'requestCode',{email:address});
    email = address;
    hideData('Se o endereço estiver autorizado, você receberá um código por e-mail.','login');
    verifyForm.elements.code.focus();
  });
  submit(verifyForm,async data=>{
    const access = await rpc(null,'verifyCode',{email,code:data.get('code')});
    verifyForm.reset();
    email = null;
    if (!permitted(access.user)) {
      hideData('Esta conta não tem acesso ao painel. Use um e-mail autorizado.','login');
      return;
    }
    const {user,token,expires} = access;
    localStorage.setItem(sessionKey,JSON.stringify({user,token,expires}));
    await refresh();
  });
  get('change-email').onclick = () => {
    email = null;
    verifyForm.reset();
    hideData('Informe o e-mail autorizado para o painel.','login');
    requestForm.elements.email.focus();
  };
  get('retry').onclick = refresh;
  async function downloadReport(button, error, filename, create, hasData) {
    const activeToken = sessionToken;
    button.disabled = true;
    error.hidden = true;
    try {
      const Pdf = window.jspdf?.jsPDF;
      if (!Pdf) throw Error('O gerador de PDF não carregou. Atualize a página e tente novamente.');
      const logo = document.querySelector('.brand img');
      await logo.decode();
      if (get('dashboard').hidden || sessionToken!==activeToken) return;
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 152;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0,0,200,152);
      const scale = Math.min(200/logo.naturalWidth,152/logo.naturalHeight);
      const width = logo.naturalWidth*scale, height = logo.naturalHeight*scale;
      context.drawImage(logo,(200-width)/2,(152-height)/2,width,height);
      const now = Date.now();
      const pdf = create(Pdf,{logo:canvas.toDataURL('image/jpeg',0.94),now,demo,date:value=>date.format(value)});
      const day = new Intl.DateTimeFormat('sv-SE',{timeZone:zone}).format(now);
      pdf.save((demo?'DEMO-':'')+'DER-'+filename+'-'+day+'.pdf');
    } catch (cause) {
      error.textContent = cause.message || 'Não foi possível gerar o PDF.';
      error.hidden = false;
    } finally {
      button.disabled = !hasData();
    }
  }
  get('download-pdf').onclick = () => {
    const items = pending;
    return downloadReport(get('download-pdf'),get('pdf-error'),'nao-conformidades',
      (Pdf,options)=>nonconformityPdf(Pdf,items,options),()=>pending.length);
  };
  get('download-km-pdf').onclick = () => {
    const data = mileagePeriod(get('km-period').value,Date.now());
    const base = bases.find(([code])=>code===kmBase.value)?.[1] || 'Todas as bases';
    return downloadReport(get('download-km-pdf'),get('km-pdf-error'),'quilometragem-da-frota',
      (Pdf,options)=>mileagePdf(Pdf,data,{...options,base}),()=>mileagePeriod(get('km-period').value,Date.now()).totals.length);
  };
  get('refresh-now').onclick = refresh;
  get('previous').onclick = () => { page--; renderRows(); };
  get('next').onclick = () => { page++; renderRows(); };
  const updateFilters = () => { page = 0; renderRows(); };
  search.oninput = updateFilters;
  filter.onchange = updateFilters;
  pendingBase.onchange = updateFilters;
  trendBase.onchange = renderOverview;
  get('km-period').onchange = renderMileage;
  kmBase.onchange = renderMileage;
  get('open-km-month').onclick = () => {
    get('km-period').value = 'month';
    kmBase.value = '';
    renderMileage();
    const mileage = get('mileage');
    activateTab(get('tab-mileage'));
    mileage.scrollIntoView({block:'start'});
    get('km-period').focus({preventScroll:true});
  };
  get('material-search').oninput = renderMaterials;
  get('resolved-period').onchange = renderResolved;
  get('resolved-search').oninput = renderResolved;
  const tabs = [...get('sections').querySelectorAll('[role="tab"]')];
  function activateTab(selected) {
    for (const tab of tabs) {
      const active = tab===selected;
      tab.setAttribute('aria-selected',String(active));
      tab.tabIndex = active?0:-1;
      get(tab.getAttribute('aria-controls')).hidden = !active;
    }
  }
  for (const [index,tab] of tabs.entries()) {
    tab.onclick = () => activateTab(tab);
    tab.onkeydown = event => {
      const positions = {ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length,Home:0,End:tabs.length-1};
      if (!Object.hasOwn(positions,event.key)) return;
      event.preventDefault();
      const target = tabs[positions[event.key]];
      activateTab(target);
      target.focus();
    };
  }
  get('clear-filters').onclick = () => { search.value = ''; filter.value = 'all'; pendingBase.value = ''; updateFilters(); search.focus(); };
  vehicleDialog.addEventListener('close',()=>{
    if (!get('dashboard').hidden) {
      renderRows();
      renderMaterials();
      renderResolved();
      renderMileage();
      renderOverview();
    }
  });
  if (demo) {
    get('demo-notice').hidden = false;
    loadRecords(new Map(demonstrationRecords(Date.now()).map(record=>[record.id,record])));
    status('Fonte da demonstração: registros fictícios.');
    render();
    return;
  }
  window.addEventListener('storage',event=>{
    if (event.key!==null && event.key!==sessionKey) return;
    if (session()?.token!==sessionToken) hideData('A sessão mudou. Atualizando acesso…');
    refresh();
  });
  setInterval(refresh,60000);
  refresh();
}
