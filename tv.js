'use strict';

function openNonconformities(records) {
  const open = new Map();
  for (const record of [...records].sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id))) {
    const seen = new Set();
    for (const item of record.results) {
      const identity = item.id || String(item.title || '').trim().toLocaleLowerCase('pt-BR');
      if (!identity) continue;
      const key = JSON.stringify([record.prefix,identity]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.value==='Conforme' || item.value==='OK') {
        open.delete(key);
      } else if (item.value==='Não Conforme' || item.value==='Problema') {
        const prior = open.get(key);
        open.set(key,{...item,prefix:record.prefix,first:prior?.first ?? record.at,
          last:record.at,count:(prior?.count ?? 0)+1});
      }
    }
  }
  return [...open.values()].sort((a,b)=>Number(Boolean(b.critical))-Number(Boolean(a.critical)) ||
    a.first-b.first || a.prefix.localeCompare(b.prefix,'pt-BR'));
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
    row('DEMO-308',31,6350,cones(19)), row('DEMO-308',6,6405,cones(20),flashlight)
  ];
}

if (typeof module!=='undefined') module.exports = {openNonconformities,shiftMileage,demonstrationRecords};
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
  let records = new Map(), latest = new Map(), pending = [], page = 0;
  const requestForm = get('request-code'), verifyForm = get('verify-code');
  const permitted = user => ['owner','manager','viewer','engineer'].includes(user?.role);
  const search = get('search'), filter = get('filter'), vehicleDialog = get('vehicle-dialog');
  const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const shortage = item => Number.isFinite(item.expected) && Number.isFinite(item.found) && item.found<item.expected
    ? item.expected-item.found : 0;
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
    checkpoint = null;
    syncedAt = null;
    page = 0;
    get('rows').replaceChildren();
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

  function age(timestamp) {
    const minutes = Math.max(0,Math.floor((Date.now()-timestamp)/60000));
    if (minutes<1) return 'Agora';
    if (minutes<60) return 'Há '+minutes+' min';
    const hours = Math.floor(minutes/60);
    const days = Math.floor(hours/24);
    return days ? 'Há '+days+(days===1?' dia':' dias') : 'Há '+hours+' h';
  }

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

  function renderMileage() {
    const days = Number(get('km-period').value);
    const {totals,skipped} = shiftMileage(records.values(),days?Date.now()-days*86400000:0);
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
    get('km-total').textContent = totals.length ? number.format(totals.reduce((sum,entry)=>sum+entry.total,0))+' km no período'
      : 'Sem trechos calculáveis no período';
    get('km-note').textContent = 'Diferença entre odômetros consecutivos da mesma viatura, atribuída à data da última leitura.'+
      (skipped?' '+skipped+' '+(skipped===1?'trecho sem leituras válidas':'trechos sem leituras válidas')+'.':'');
  }

  function renderRows() {
    const query = normalize(search.value.trim());
    const visible = pending.filter(item=>{
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
      addText(first,'span',age(item.first),'age');
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
    get('affected').textContent = new Set(pending.map(item=>item.prefix)).size;
    get('pending').textContent = pending.length;
    get('critical').textContent = pending.filter(item=>item.critical).length;
    get('dashboard').hidden = false;
    get('gate').hidden = true;
    get('refresh-now').hidden = demo;
    if (!vehicleDialog.open) {
      renderRows();
      renderMileage();
    }
  }

  function status(message,stale = false) {
    get('sync-state').textContent = message;
    get('sync-state').classList.toggle('stale',stale);
  }

  function loadRecords(nextRecords) {
    pending = openNonconformities(nextRecords.values());
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
  get('refresh-now').onclick = refresh;
  get('previous').onclick = () => { page--; renderRows(); };
  get('next').onclick = () => { page++; renderRows(); };
  const updateFilters = () => { page = 0; renderRows(); };
  search.oninput = updateFilters;
  filter.onchange = updateFilters;
  get('km-period').onchange = renderMileage;
  get('clear-filters').onclick = () => { search.value = ''; filter.value = 'all'; updateFilters(); search.focus(); };
  vehicleDialog.addEventListener('close',()=>{
    if (!get('dashboard').hidden) {
      renderRows();
      renderMileage();
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
