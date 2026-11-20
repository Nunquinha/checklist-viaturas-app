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

if (typeof module!=='undefined') module.exports = {openNonconformities};
if (typeof document!=='undefined') startPanel();

function startPanel() {
  const get = id => document.getElementById(id);
  const sessionKey = 'checklist-cloud-session-v1';
  const endpoint = document.querySelector('meta[name="checklist-endpoint"]').content;
  const zone = 'America/Sao_Paulo';
  const date = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:zone});
  const clock = new Intl.DateTimeFormat('pt-BR',{timeStyle:'medium',timeZone:zone});
  const pageSize = 5;
  let sessionToken, accessScope, checkpoint, refreshing = false, syncedAt = null;
  let records = new Map(), pending = [], page = 0;
  const requestForm = get('request-code'), verifyForm = get('verify-code');
  const permitted = user => ['owner','manager','viewer'].includes(user?.role);
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
    pending = [];
    checkpoint = null;
    syncedAt = null;
    page = 0;
    get('rows').replaceChildren();
    ['affected','pending','critical','repeated'].forEach(id=>get(id).textContent='');
    get('dashboard').hidden = true;
    get('gate-message').textContent = message;
    get('gate').hidden = false;
    requestForm.hidden = action!=='login' || Boolean(email);
    verifyForm.hidden = action!=='login' || !email;
    get('retry').hidden = action!=='retry';
  }

  function age(timestamp) {
    const minutes = Math.max(0,Math.floor((Date.now()-timestamp)/60000));
    if (minutes<60) return minutes+' min';
    const hours = Math.floor(minutes/60);
    return hours<24 ? hours+' h' : Math.floor(hours/24)+' d '+hours%24+' h';
  }

  function addText(parent, tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    parent.append(element);
  }

  function renderRows() {
    const pages = Math.max(1,Math.ceil(pending.length/pageSize));
    page = (page%pages+pages)%pages;
    const rows = document.createDocumentFragment();
    for (const item of pending.slice(page*pageSize,(page+1)*pageSize)) {
      const row = rows.appendChild(document.createElement('tr'));
      addText(row.insertCell(),'strong',item.prefix);
      const details = row.insertCell();
      addText(details,'strong',item.title || 'Item sem nome');
      if (item.critical) addText(details,'span','Crítico','badge critical');
      if (item.found!=null) addText(details,'span',item.expected==null
        ? item.found+' encontrados'
        : item.found+' encontrados · '+item.expected+' exigidos','line');
      addText(details,'span',item.note || 'Registro sem justificativa','line');
      const first = row.insertCell();
      addText(first,'span',age(item.first),'age');
      addText(first,'time',date.format(item.first),'line');
      addText(row.insertCell(),'time',date.format(item.last));
      addText(row.insertCell(),'strong',item.count);
    }
    get('rows').replaceChildren(rows);
    get('pagination').hidden = pages===1;
    get('pager').textContent = (page+1)+' / '+pages;
  }

  function render() {
    get('affected').textContent = new Set(pending.map(item=>item.prefix)).size;
    get('pending').textContent = pending.length;
    get('critical').textContent = pending.filter(item=>item.critical).length;
    get('repeated').textContent = pending.filter(item=>item.count>1).length;
    get('table').hidden = pending.length===0;
    get('empty').hidden = pending.length>0;
    get('empty').textContent = records.size ? 'Nenhuma não conformidade em aberto.' : 'Nenhum checklist diário disponível para este acesso.';
    get('dashboard').hidden = false;
    get('gate').hidden = true;
    renderRows();
  }

  function status(message,stale = false) {
    get('sync-state').textContent = message;
    get('sync-state').classList.toggle('stale',stale);
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
          nextRecords.set(record.id,{id:record.id,prefix:record.prefix,at,results});
        }
        cursor = batch.cursor;
      } while (cursor>0);
      pending = openNonconformities(nextRecords.values());
      records = nextRecords;
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
  get('previous').onclick = () => { page--; renderRows(); };
  get('next').onclick = () => { page++; renderRows(); };
  const fullscreen = get('fullscreen');
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreen.textContent = 'Tela cheia indisponível';
    }
  };
  document.addEventListener('fullscreenchange',()=>{
    fullscreen.textContent = document.fullscreenElement?'Sair da tela cheia':'Tela cheia';
  });
  window.addEventListener('storage',event=>{
    if (event.key!==null && event.key!==sessionKey) return;
    if (session()?.token!==sessionToken) hideData('A sessão mudou. Atualizando acesso…');
    refresh();
  });
  const updateClock = () => { get('clock').textContent = clock.format(Date.now()); };
  updateClock();
  setInterval(updateClock,1000);
  setInterval(refresh,60000);
  setInterval(()=>{
    if (document.fullscreenElement && !get('dashboard').hidden && !get('pagination').hidden) {
      page++;
      renderRows();
    }
  },20000);
  refresh();
}
