(() => {
  const googleBridge = window.google?.script?.run;
  const remoteEndpoint = document.querySelector('meta[name="checklist-endpoint"]')?.content;
  if (!googleBridge && !remoteEndpoint) return;

  const SESSION_KEY = 'checklist-cloud-session-v1';
  const blank = () => ({vehicles:[],items:[],operators:[],records:[],version:0,dirty:false});
  const nav = [...document.querySelectorAll('nav [data-page]')];
  const account = byId('cloud-account');
  const login = byId('cloud-login');
  const requestForm = byId('request-code');
  const verifyForm = byId('verify-code');
  const syncButton = byId('sync-cloud');
  const logoutButton = byId('cloud-logout');
  const accessForm = byId('access-form');
  const accessList = byId('access-list');
  let session, email, syncing = false, scheduled = false;

  function rpc(action,body = {},token = session?.token) {
    const request = {action,body,token:token || null};
    if (!googleBridge) return fetch(remoteEndpoint,{
      method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},
      credentials:'omit',cache:'no-store',redirect:'follow',
      body:JSON.stringify(request),signal:AbortSignal.timeout(40000)
    }).then(response=>{
      if (!response.ok) throw new Error();
      return response.json();
    }).catch(()=>{
      throw new Error('Conexão indisponível. Os registros pendentes continuam neste aparelho.');
    }).then(unwrap);
    return new Promise((resolve,reject) => {
      googleBridge.withSuccessHandler(resolve)
        .withFailureHandler(() => reject(new Error('Conexão indisponível. Os registros pendentes continuam neste aparelho.')))
        .checklistRpc(request);
    }).then(unwrap);
  }
  function unwrap(response) {
    if (response?.ok) return response.data;
    throw new Error(response?.error || 'Resposta inesperada da base central.');
  }

  function error(message = '') {
    byId('cloud-error').hidden = !message;
    byId('cloud-error').textContent = message;
  }

  function load(key,fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  }

  const suffix = () => session ? ':'+session.user.email+':'+(session.user.prefix || '')+':'+session.user.role : '';
  const write = next => localStorage.setItem('checklist-cloud-data-v1'+suffix(),JSON.stringify(next));
  const active = () => Boolean(session && session.expires>Date.now());
  const readingOnly = () => ['viewer','engineer'].includes(session?.user.role);
  const canOpen = page => {
    if (!active()) return false;
    if (page==='acessos') return Boolean(session.user.owner);
    if (readingOnly()) return ['historico','historico-quinzenal'].includes(page) ||
      (page==='ocorrencias' && session.user.role==='viewer');
    return session.user.admin || !['viaturas','cadastros','operadores'].includes(page);
  };
  function persist(previous,next) {
    if (!active()) throw new Error('Entre novamente para registrar ou editar.');
    const changed = ['vehicles','items','operators'].some(key=>previous[key]!==next[key]);
    if (changed && !session.user.admin) throw new Error('Apenas a administração pode alterar cadastros.');
    next.dirty = Boolean(previous.dirty || changed);
    write(next);
    schedule();
  }

  function schedule() {
    if (!active() || scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; sync(); },250);
  }

  window.checklistCloud = {
    enabled:true,canOpen,persist,schedule,showAccess,
    get canReport(){ return active() && session.user.role!=='engineer'; },
    get canDeleteCatalog(){ return active() && Boolean(session.user.owner); },
    get canFileIncident(){ return active() && !readingOnly(); },
    get vehicle(){ return active() ? session.user.prefix : null; },
    get storageSuffix(){ return suffix(); }
  };

  function changeSession(next) {
    if (database) database.then(db=>db.close()).catch(()=>{});
    database = undefined;
    session = next;
    historyFilters.daily = {};
    historyFilters.fortnight = {};
    state = active() ? load('checklist-cloud-data-v1'+suffix(),blank()) : blank();
    login.hidden = active();
    account.hidden = !active();
    nav.forEach(button => button.hidden = !canOpen(button.dataset.page));
    fields.vehicle.disabled = fortnightFields.vehicle.disabled = Boolean(session?.user.prefix);
    // A disabled input is omitted by FormData; the record also uses the locked VTR.
    handover.reset();
    resetIncident();
    handoverStarted = fortnightStarted = null;
    resumed = null;
    shown = [];
    byId('resuming').hidden = true;
    byId('checks').replaceChildren();
    fortnight.reset();
    buildPads([]);
    refreshFortnightPads();
    refresh();
    renderChecks();
    for (const section of document.querySelectorAll('main > section')) section.hidden = true;
    if (active()) {
      const roles = {owner:'Administração',manager:'Gestão',viewer:'Consulta',engineer:'Engenheiro'};
      byId('cloud-identity').textContent = [roles[session.user.role],session.user.prefix].filter(Boolean).join(' · ');
      byId('cloud-status').textContent = 'Aguardando sincronização';
      page(readingOnly()?'historico':'troca');
      schedule();
    }
  }

  function updateStatus(text) { byId('cloud-status').textContent = text; }

  async function sync() {
    if (syncing || !active()) return;
    if (!navigator.onLine) {
      updateStatus('Sem sinal · registros salvos neste aparelho');
      return;
    }
    syncing = true;
    syncButton.disabled = logoutButton.disabled = true;
    updateStatus('Sincronizando com o Drive…');
    error();
    let again = false;
    try {
      const user = await rpc('me');
      if (session.user.role!==user.role || session.user.prefix!==user.prefix) {
        const updated = {...session,user};
        localStorage.setItem(SESSION_KEY,JSON.stringify(updated));
        changeSession(updated);
        again = true;
        return;
      }
      const local = state;
      if (local.dirty) {
        const {version,vehicles,items,operators} = local;
        const saved = await rpc('saveCatalog',{version,vehicles,items,operators});
        again = ['vehicles','items','operators'].some(key=>local[key]!==state[key]);
        const next = {...state,version:saved.version,dirty:again};
        write(next);
        state = next;
      } else {
        const central = await rpc('catalog');
        if (!state.dirty) {
          const catalogChanged = central.version!==state.version || !state.catalogLoaded;
          const next = {...state,...central,catalogLoaded:true};
          write(next);
          state = next;
          if (catalogChanged && !handoverStarted && !fortnightStarted) {
            refresh();
            renderChecks();
            refreshFortnightChoices();
            if (!incidentFields.description.value) refreshIncidentChoices();
          }
        } else again = true;
      }

      for (const record of state.records.filter(record=>!record.cloudSaved)) {
        const {cloudSaved,...body} = record;
        await rpc('saveRecord',{kind:'daily',record:body});
        const next = {...state,records:state.records.map(entry=>entry.id===record.id?{...entry,cloudSaved:true}:entry)};
        write(next);
        state = next;
      }
      for (const record of (await inspections()).filter(record=>!record.cloudSaved)) {
        const {cloudSaved,...body} = record;
        await rpc('saveRecord',{kind:'fortnight',record:body});
        await inspections({...record,cloudSaved:true});
      }
      for (const record of (await incidents()).filter(record=>!record.cloudSaved)) {
        const {cloudSaved,...body} = record;
        await rpc('saveRecord',{kind:'incident',record:body});
        await incidents({...record,cloudSaved:true});
      }

      let cursor, head, reachedCheckpoint = false;
      const checkpoint = state.historyCheckpoint;
      do {
        const dailyIds = new Set(state.records.map(record=>record.id));
        const fortnightIds = new Set((await inspections()).map(record=>record.id));
        const incidentIds = new Set((await incidents()).map(record=>record.id));
        const batch = await rpc('listRecords',{cursor:cursor ?? null});
        head ??= batch.records[0]?.record.id;
        const daily = [];
        for (const {kind,record} of batch.records) {
          if (record.id===checkpoint) { reachedCheckpoint = true; break; }
          if (kind==='daily' && !dailyIds.has(record.id)) daily.push({...record,cloudSaved:true});
          if (kind==='fortnight' && !fortnightIds.has(record.id)) await inspections({...record,cloudSaved:true});
          if (kind==='incident' && !incidentIds.has(record.id)) await incidents({...record,cloudSaved:true});
        }
        if (daily.length) {
          const next = {...state,records:[...daily,...state.records].sort((a,b)=>b.id.localeCompare(a.id))};
          write(next);
          state = next;
        }
        cursor = batch.cursor;
      } while(cursor>0 && !reachedCheckpoint);
      if (head && head!==checkpoint) {
        const next = {...state,historyCheckpoint:head};
        write(next);
        state = next;
      }
      updateStatus('Dados sincronizados');
      if (!byId('historico').hidden) { historyView(); refreshFortnightHistory(); }
      if (!byId('ocorrencias').hidden) refreshIncidentHistory();
      again ||= state.dirty || state.records.some(record=>!record.cloudSaved) ||
        (await inspections()).some(record=>!record.cloudSaved) || (await incidents()).some(record=>!record.cloudSaved);
    } catch (failure) {
      updateStatus('Sincronização pendente');
      if (failure.message==='Acesso expirado ou removido.') {
        localStorage.removeItem(SESSION_KEY);
        verifyForm.hidden = true;
        requestForm.hidden = false;
        changeSession(null);
      }
      error(failure.message);
    } finally {
      syncing = false;
      syncButton.disabled = logoutButton.disabled = false;
      if (again) schedule();
    }
  }

  function renderAccess(entries) {
    accessList.replaceChildren();
    if (!entries.length) { accessList.textContent='Nenhum acesso adicional cadastrado.'; return; }
    for (const entry of entries) {
      const row = document.createElement('div');
      const details = document.createElement('p');
      const revoke = document.createElement('button');
      const labels = {manager:'Gestão',viewer:'Consulta e relatórios',engineer:'Engenheiro'};
      details.textContent = entry.email+' · '+labels[entry.role]+
        (entry.prefix?' · '+entry.prefix:' · Toda a frota');
      revoke.textContent = 'Revogar';
      revoke.type = 'button';
      revoke.onclick = async () => {
        if (!confirm('Revogar o acesso de '+entry.email+'?')) return;
        revoke.disabled = true;
        try { renderAccess(await rpc('saveAccess',{email:entry.email,remove:true})); }
        catch (failure) { error(failure.message); revoke.disabled = false; }
      };
      row.className = 'split';
      row.append(details,revoke);
      accessList.append(row);
    }
  }
  async function showAccess() {
    if (!canOpen('acessos')) return;
    const select = accessForm.elements.prefix;
    select.replaceChildren(new Option('Toda a frota',''));
    for (const vehicle of state.vehicles) select.add(new Option(vehicle.prefix,vehicle.prefix));
    try { renderAccess(await rpc('listAccess')); }
    catch (failure) { accessList.textContent=failure.message; }
  }
  accessForm.elements.role.onchange = () => {
    const scope = byId('access-scope');
    scope.hidden = accessForm.elements.role.value==='manager';
    scope.querySelector('select').disabled = scope.hidden;
  };
  accessForm.onsubmit = async event => {
    event.preventDefault();
    const button = accessForm.querySelector('button');
    button.disabled = true;
    error();
    try {
      const entries = await rpc('saveAccess',Object.fromEntries(new FormData(accessForm)));
      renderAccess(entries);
      accessForm.reset();
      accessForm.elements.role.onchange();
    } catch (failure) { error(failure.message); }
    finally { button.disabled = false; }
  };

  requestForm.onsubmit = async event => {
    event.preventDefault();
    error();
    email = requestForm.elements.email.value.trim().toLowerCase();
    const button = requestForm.querySelector('button');
    button.disabled = true;
    try {
      await rpc('requestCode',{email});
      requestForm.hidden = true;
      verifyForm.hidden = false;
      verifyForm.elements.code.focus();
    } catch (failure) { error(failure.message); }
    finally { button.disabled = false; }
  };
  verifyForm.onsubmit = async event => {
    event.preventDefault();
    error();
    const button = verifyForm.querySelector('button');
    button.disabled = true;
    try {
      const next = await rpc('verifyCode',{email,code:verifyForm.elements.code.value});
      localStorage.setItem(SESSION_KEY,JSON.stringify(next));
      verifyForm.reset();
      changeSession(next);
    } catch (failure) { error(failure.message); }
    finally { button.disabled = false; }
  };
  byId('change-email').onclick = () => {
    verifyForm.reset(); verifyForm.hidden = true; requestForm.hidden = false; error();
  };
  logoutButton.onclick = () => {
    localStorage.removeItem(SESSION_KEY);
    verifyForm.hidden = true;
    requestForm.hidden = false;
    error();
    changeSession(null);
  };
  syncButton.onclick = sync;
  window.addEventListener('online',schedule);
  window.addEventListener('offline',()=>{
    if (active()) updateStatus('Sem sinal · registros salvos neste aparelho');
  });
  byId('cloud-panel').hidden = false;
  byId('local-mode').hidden = true;
  byId('vehicle-email-hint').textContent = 'O código de acesso é enviado ao e-mail vinculado ao prefixo.';
  changeSession(load(SESSION_KEY,null));
})();
