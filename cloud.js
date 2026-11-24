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
  let session, email, syncing = false, scheduled = false, syncRequested = false;
  let retryTimer, retryDelay = 5000;
  let queueRequest = 0;

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
  const active = () => Boolean(session?.token && (session.expires>Date.now() ||
    (session.user.role==='vehicle' && session.expires===null)));
  const readingOnly = () => ['viewer','engineer'].includes(session?.user.role);
  const isVehicleSession = () => session?.user.role==='vehicle';
  const catalogPages = ['viaturas','cadastros','operadores'];
  const canEditCatalog = () => Boolean(session?.user.admin || session?.user.role==='engineer');
  const canOpen = page => {
    if (!active()) return false;
    if (isVehicleSession()) return ['troca','quinzenal','ocorrencias'].includes(page);
    if (page==='acessos') return Boolean(session.user.owner);
    if (readingOnly()) return ['historico','historico-quinzenal'].includes(page) ||
      (session.user.role==='engineer' && catalogPages.includes(page)) ||
      (page==='historico-ocorrencias' && session.user.role==='viewer');
    return canEditCatalog() || !catalogPages.includes(page);
  };
  function persist(previous,next) {
    if (!active()) throw new Error('Entre novamente para registrar ou editar.');
    const changed = ['vehicles','items','operators'].some(key=>previous[key]!==next[key]);
    if (changed && !canEditCatalog()) throw new Error('Este perfil não pode atualizar cadastros.');
    next.dirty = Boolean(previous.dirty || changed);
    if (changed && !previous.dirty) next.catalogBase=ChecklistCatalogSync.snapshot(previous);
    write(next);
    if (changed) {
      updateStatus('Cadastros salvos no aparelho · aguardando envio','offline');
      setTimeout(refreshPendingQueue,0);
    }
    schedule();
  }

  function schedule() {
    if (!active()) return;
    if (syncing) { syncRequested=true; return; }
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; sync(); },250);
  }

  function recordSaved(label) {
    const message = byId('notice');
    message.textContent = label+' no aparelho. '+(navigator.onLine
      ? 'O app vai sincronizar automaticamente.'
      : 'Sem conexão. Será enviado quando o app estiver aberto e a internet voltar.');
    message.scrollIntoView({block:'nearest'});
    refreshPendingQueue();
    schedule();
  }

  async function refreshPendingQueue() {
    const request = ++queueRequest, queue = byId('cloud-queue');
    if (!active()) { queue.hidden = true; return; }
    try {
      const [fortnight,incident] = await Promise.all([inspections(),incidents()]);
      if (request!==queueRequest) return;
      const count = [state.records,fortnight,incident].reduce((sum,records)=>
        sum+records.filter(record=>!record.cloudSaved).length,0);
      const parts=[];
      if(state.dirty)parts.push('Cadastros aguardando envio');
      if(count)parts.push(count===1?'1 lançamento aguardando envio':count+' lançamentos aguardando envio');
      queue.hidden = !parts.length;
      queue.textContent = parts.join(' · ');
    } catch {
      if (request===queueRequest) queue.hidden = true;
    }
  }

  const deletedFortnightIds = new Set();
  const deletedIncidentIds = new Set();

  window.checklistCloud = {
    enabled:true,canOpen,persist,schedule,showAccess,recordSaved,
    get canReport(){ return active() && !isVehicleSession() && session.user.role!=='engineer'; },
    get canExportExcel(){ return active() && !isVehicleSession(); },
    get canReadHistory(){ return active() && !isVehicleSession(); },
    get canDeleteCatalog(){ return active() && Boolean(session.user.owner); },
    get canDeleteFortnight(){ return active() && Boolean(session.user.owner); },
    get canDeleteIncident(){ return active() && Boolean(session.user.owner); },
    async deleteIncident({id,prefix}) {
      const currentSession = session;
      await rpc('deleteIncident',{id,prefix});
      if (session!==currentSession) return;
      deletedIncidentIds.add(id);
      await removeEvidence('incidents',[id]);
    },
    async deleteFortnight({id,prefix}) {
      const currentSession = session;
      await rpc('deleteFortnight',{id,prefix});
      if (session!==currentSession) return;
      deletedFortnightIds.add(id);
      await removeEvidence('inspections',[id]);
    },
    get canFileIncident(){ return active() && !readingOnly(); },
    get vehicle(){ return active() ? session.user.prefix : null; },
    get storageSuffix(){ return suffix(); }
  };

  function changeSession(next,initialCatalog) {
    if (database) database.then(db=>db.close()).catch(()=>{});
    database = undefined;
    session = next;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    retryDelay = 5000;
    deletedFortnightIds.clear();
    deletedIncidentIds.clear();
    resetIncidentHistoryFilters();
    historyFilters.daily = {};
    historyFilters.fortnight = {};
    state = active() ? load('checklist-cloud-data-v1'+suffix(),blank()) : blank();
    byId('cloud-queue').hidden = true;
    refreshPendingQueue();
    if(initialCatalog&&!state.dirty) {
      state = {...state,...initialCatalog,catalogLoaded:true};
      try { write(state); } catch { /* The active session can still use this catalog in memory. */ }
    }
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

  function updateStatus(text,connection='online') {
    byId('cloud-status').textContent = text;
    account.dataset.connection = connection;
  }

  function showOfflineStatus() {
    updateStatus('Sem conexão · lançamentos ficam salvos no aparelho','offline');
  }

  async function sync() {
    if (syncing || !active()) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    if (!navigator.onLine) {
      showOfflineStatus();
      return;
    }
    syncing = true;
    const syncSuffix=suffix(), syncToken=session.token;
    const rpcSync=async(action,body)=>{
      const result=await rpc(action,body,syncToken);
      if(suffix()!==syncSuffix || !active())throw Error('A conta mudou durante a sincronização.');
      return result;
    };
    syncRequested = false;
    syncButton.disabled = logoutButton.disabled = true;
    updateStatus('Sincronizando com o Drive…');
    error();
    let again = false;
    try {
      const version = state.catalogLoaded?state.version:null;
      const {user,catalog:central,renewedSession} = await rpcSync('bootstrap',{version,rememberVehicle:true});
      if (session.user.role!==user.role || session.user.prefix!==user.prefix) {
        const updated = {...session,user,...renewedSession};
        localStorage.setItem(SESSION_KEY,JSON.stringify(updated));
        changeSession(updated);
        again = true;
        return;
      }
      if (renewedSession) {
        const updated = {...session,...renewedSession};
        localStorage.setItem(SESSION_KEY,JSON.stringify(updated));
        session = updated;
      }
      const local = state;
      if (local.dirty) {
        let draft={version:local.version,...ChecklistCatalogSync.snapshot(local)};
        let remote=central, saved;
        for(let attempt=0;attempt<3;attempt++) {
          if(remote && remote.version!==draft.version) {
            const merged=ChecklistCatalogSync.merge(local.catalogBase,local,remote);
            if(merged.conflicts.length)throw Error('Cadastros com alterações simultâneas ou pendências antigas: '+
              merged.conflicts.map(row=>row.name).slice(0,4).join(', ')+
              '. A cópia deste aparelho foi preservada. Exporte os pendentes para revisão.');
            draft=merged.catalog;
          }
          try { saved=await rpcSync('saveCatalog',draft); break; }
          catch(failure) {
            if(!failure.message.startsWith('Os cadastros mudaram'))throw failure;
            if(attempt===2)throw Error('A base está recebendo outras alterações. Seus cadastros estão preservados e serão reenviados.');
            remote=await rpcSync('catalog');
          }
        }
        again = ['vehicles','items','operators'].some(key=>local[key]!==state[key]);
        const during=again?ChecklistCatalogSync.merge(ChecklistCatalogSync.snapshot(local),state,saved):null;
        const next = {...state,...(!again?ChecklistCatalogSync.snapshot(saved):
          during.conflicts.length?{}:ChecklistCatalogSync.snapshot(during.catalog)),
          version:again&&during.conflicts.length?local.version:saved.version,catalogLoaded:true,dirty:again};
        if(again)next.catalogBase=ChecklistCatalogSync.snapshot(during.conflicts.length?local:saved);else delete next.catalogBase;
        write(next);
        state = next;
        if(!again && !handoverStarted && !fortnightStarted)refresh();
      } else {
        if (!state.dirty && central) {
          const catalogChanged = central.version!==state.version || !state.catalogLoaded ||
            ['vehicles','items','operators'].some(key=>central[key]?.length!==state[key]?.length);
          const next = {...state,...central,catalogLoaded:true};
          write(next);
          state = next;
          if (catalogChanged && !handoverStarted && !fortnightStarted) {
            refresh();
            renderChecks();
            refreshFortnightChoices();
            if (!incidentFields.description.value) refreshIncidentChoices();
          }
        } else if(state.dirty) again = true;
      }

      for (const record of state.records.filter(record=>!record.cloudSaved)) {
        const {cloudSaved,...body} = record;
        await rpcSync('saveRecord',{kind:'daily',record:body});
        const next = {...state,records:state.records.map(entry=>entry.id===record.id?{...entry,cloudSaved:true}:entry)};
        write(next);
        state = next;
      }
      const [localFortnight,localIncident] = await Promise.all([inspections(),incidents()]);
      for (const record of localFortnight.filter(record=>!record.cloudSaved)) {
        const {cloudSaved,...body} = record;
        await rpcSync('saveRecord',{kind:'fortnight',record:body});
        if (!deletedFortnightIds.has(record.id)) await inspections({...record,cloudSaved:true});
      }
      for (const record of localIncident.filter(record=>!record.cloudSaved)) {
        const {cloudSaved,...body} = record;
        await rpcSync('saveRecord',{kind:'incident',record:body});
        if (!deletedIncidentIds.has(record.id)) await incidents({...record,cloudSaved:true});
      }

      if (isVehicleSession()) {
        const daily = state.records.filter(record=>!record.cloudSaved);
        if (daily.length!==state.records.length || state.historyCheckpoint) {
          const next = {...state,records:daily,historyCheckpoint:null};
          write(next);
          state = next;
        }
        await Promise.all([
          removeEvidence('inspections',localFortnight.map(record=>record.id)),
          removeEvidence('incidents',localIncident.map(record=>record.id))
        ]);
        const [pendingFortnight,pendingIncident]=await Promise.all([inspections(),incidents()]);
        again=state.dirty || state.records.some(row=>!row.cloudSaved) ||
          pendingFortnight.some(row=>!row.cloudSaved) || pendingIncident.some(row=>!row.cloudSaved);
        updateStatus(again?'Enviando alterações pendentes…':'Dados sincronizados',again?'offline':'online');
        retryDelay = 5000;
        return;
      }

      let cursor, head, reachedCheckpoint = false;
      const checkpoint = state.historyCheckpoint;
      const fortnightIds = new Set(localFortnight.map(record=>record.id));
      const incidentIds = new Set(localIncident.map(record=>record.id));
      do {
        const dailyIds = new Set(state.records.map(record=>record.id));
        const batch = await rpcSync('listRecords',{cursor:cursor ?? null,checkpoint:checkpoint ?? null});
        if (batch.deletedFortnightIds?.length) {
          batch.deletedFortnightIds.forEach(id=>deletedFortnightIds.add(id));
          await removeEvidence('inspections',batch.deletedFortnightIds);
        }
        if (batch.deletedIncidentIds?.length) {
          batch.deletedIncidentIds.forEach(id=>deletedIncidentIds.add(id));
          await removeEvidence('incidents',batch.deletedIncidentIds);
        }
        head ??= batch.records[0]?.record.id;
        const daily = [];
        for (const {kind,record} of batch.records) {
          if (record.id===checkpoint) { reachedCheckpoint = true; break; }
          if (kind==='daily' && !dailyIds.has(record.id)) daily.push({...record,cloudSaved:true});
          if (kind==='fortnight' && !fortnightIds.has(record.id) && !deletedFortnightIds.has(record.id)) {
            await inspections({...record,cloudSaved:true});
            fortnightIds.add(record.id);
          }
          if (kind==='incident' && !incidentIds.has(record.id) && !deletedIncidentIds.has(record.id)) {
            await incidents({...record,cloudSaved:true});
            incidentIds.add(record.id);
          }
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
      const [pendingFortnight,pendingIncident]=await Promise.all([inspections(),incidents()]);
      again ||= state.dirty || state.records.some(record=>!record.cloudSaved) ||
        pendingFortnight.some(record=>!record.cloudSaved) || pendingIncident.some(record=>!record.cloudSaved);
      updateStatus(again?'Enviando alterações pendentes…':'Dados sincronizados',again?'offline':'online');
      retryDelay = 5000;
      if (!byId('historico').hidden) { historyView(); refreshFortnightHistory(); }
      if (!byId('historico-ocorrencias').hidden) refreshIncidentHistory();
      again ||= state.dirty || state.records.some(record=>!record.cloudSaved);
    } catch (failure) {
      if(suffix()!==syncSuffix)return;
      if (!navigator.onLine) {
        showOfflineStatus();
      } else {
        updateStatus('Sincronização pendente','offline');
        if ((failure.message.startsWith('Conexão indisponível') || failure.message.startsWith('A base está recebendo'))) {
          retryTimer = setTimeout(schedule,retryDelay);
          retryDelay = Math.min(retryDelay*2,60000);
        }
      }
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
      refreshPendingQueue();
      if (again || syncRequested) schedule();
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
      const {catalog,...next} = await rpc('verifyCode',{email,code:verifyForm.elements.code.value,rememberVehicle:true});
      localStorage.setItem(SESSION_KEY,JSON.stringify(next));
      verifyForm.reset();
      changeSession(next,catalog);
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
  const exportPending=byId('export-pending-catalog');
  exportPending.onclick=()=>{
    const payload={format:'checklist-catalog-draft-v1',exportedAt:new Date().toISOString(),
      account:session?.user?.email || '',version:state.version,dirty:state.dirty,
      catalog:ChecklistCatalogSync.snapshot(state),base:state.catalogBase || null};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const link=document.createElement('a'),url=URL.createObjectURL(blob);
    link.href=url;link.download='Checklist-DER-cadastros-do-aparelho.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  syncButton.onclick = sync;
  window.addEventListener('online',schedule);
  window.addEventListener('pageshow',schedule);
  window.addEventListener('focus',schedule);
  setInterval(()=>{if(document.visibilityState==='visible' && active())schedule()},30000);
  window.addEventListener('offline',()=>{
    if (active()) showOfflineStatus();
  });
  document.addEventListener('visibilitychange',()=>{
    if (document.visibilityState==='visible' && navigator.onLine) schedule();
  });
  byId('cloud-panel').hidden = false;
  byId('local-mode').hidden = true;
  byId('vehicle-email-hint').textContent = 'O código de acesso é enviado ao e-mail vinculado ao prefixo.';
  changeSession(load(SESSION_KEY,null));
})();
