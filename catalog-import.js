(() => {
  const form = byId('catalog');
  const container = document.createElement('details');
  container.innerHTML = '<summary>Importar catálogo DER</summary><p>Atualize os itens por tipo de viatura usando o arquivo JSON do catálogo.</p><label>Arquivo do catálogo<input type="file" accept=".json,application/json"></label><button type="button">Revisar importação</button><p role="status" aria-live="polite"></p><button type="button" hidden>Aplicar ao checklist</button>';
  form.after(container);
  const input = container.querySelector('input');
  const [review, apply] = container.querySelectorAll('button');
  const status = container.querySelector('[role="status"]');
  const allScopes = Object.keys(services).map(value => 's:'+value);
  const normalize = value => value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g,' ').trim();
  const scopeOf = item => itemScopes(item).includes('all') ? allScopes : itemScopes(item);
  const validImage = /^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i;
  let draft = null;

  function clearDraft() {
    draft = null;
    apply.hidden = true;
  }

  function ready() {
    return window.checklistCloud?.canDeleteCatalog === true &&
      navigator.onLine && !state.dirty && !byId('sync-cloud').disabled;
  }

  function buildImport(payload) {
    if (payload?.format !== 'checklist-der-catalog-v1' || !Array.isArray(payload.items) ||
      !payload.items.length || payload.items.length > 500) throw Error('Arquivo de catálogo DER inválido.');
    const result = [...state.items];
    const seen = new Set();
    const claimed = new Set();
    let created = 0, changed = 0, unchanged = 0, photos = 0;

    for (const incoming of payload.items) {
      const {id,title,scopes,expected,aliases,photo,rename,removePhoto} = incoming;
      if (typeof id !== 'string' || !/^der-mapa-[a-f0-9]{18}$/.test(id) || seen.has(id) ||
          typeof title !== 'string' || !title.trim() || title.length > 100 ||
          !Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length ||
          scopes.some(scope => !allScopes.includes(scope)) ||
          (rename !== undefined && typeof rename !== 'boolean') ||
          (removePhoto !== undefined && (typeof removePhoto !== 'boolean' || (removePhoto && photo))) || !Array.isArray(aliases) || aliases.some(value => typeof value !== 'string' || value.length > 100) ||
          (expected !== null && (!Number.isInteger(expected) || expected < 1 || expected > 9999)) ||
          (photo !== undefined && (typeof photo !== 'string' || photo.length > 100000 || !validImage.test(photo)))) {
        throw Error('O arquivo contém um item inválido.');
      }
      seen.add(id);
      const keys = new Set([title,...aliases].map(normalize));
      const possible = result.filter(item => !claimed.has(item.id) && !itemScopes(item).some(scope => scope.startsWith('v:')) &&
        keys.has(normalize(item.title)));
      const exact = possible.find(item => item.id === id);
      const related = exact || possible.filter(item => scopeOf(item).some(scope => scopes.includes(scope)))
        .sort((a,b) => Number(b.expected === expected) - Number(a.expected === expected) ||
          scopeOf(b).filter(scope => scopes.includes(scope)).length - scopeOf(a).filter(scope => scopes.includes(scope)).length)[0];

      if (!related) {
        if (result.some(item => item.id === id)) throw Error('Conflito de código no item '+title+'.');
        result.push({id,title,scopes,expected,active:true,critical:false,...(photo ? {photo} : {})});
        claimed.add(id);
        created++;
        if (photo) photos++;
        continue;
      }

      claimed.add(related.id);
      const previousScopes = scopeOf(related);
      const updatedQuantity = expected ?? related.expected ?? null;
      const scopesChanged = previousScopes.length !== scopes.length ||
        scopes.some(scope => !previousScopes.includes(scope));
      const newPhoto = !related.photo && photo;
      const titleChanged = rename && related.title !== title;
      const photoRemoved = removePhoto && Boolean(related.photo);
      if (!scopesChanged && updatedQuantity === (related.expected ?? null) && !newPhoto && !titleChanged && !photoRemoved) {
        unchanged++;
        continue;
      }
      const item = {...related, expected:updatedQuantity};
      if (scopesChanged) item.scopes = scopes;
      if (titleChanged) item.title = title;
      if (newPhoto) { item.photo = photo; photos++; }
      if (photoRemoved) delete item.photo;
      result[result.indexOf(related)] = item;
      changed++;
    }

    if (result.length > 500 || JSON.stringify(result).length > 3500000) {
      throw Error('O catálogo ultrapassa o tamanho permitido. Divida o arquivo antes de importar.');
    }
    return {items:result,created,changed,unchanged,photos};
  }

  input.onchange = () => { clearDraft(); status.textContent = ''; };
  review.onclick = async () => {
    clearDraft();
    if (!ready()) {
      status.textContent = 'Entre com a conta responsável e aguarde a sincronização.';
      return;
    }
    const file = input.files[0];
    if (!file || file.size > 3500000) {
      status.textContent = 'Escolha um arquivo JSON do catálogo de até 3,5 MB.';
      return;
    }
    try {
      const payload = JSON.parse(await file.text());
      draft = {...buildImport(payload),baseline:state.items,version:state.version};
      status.textContent = draft.created+' novos · '+draft.changed+' atualizados · '+draft.unchanged+' já conferidos · '+draft.photos+' fotos adicionadas.';
      apply.hidden = !draft.created && !draft.changed;
    } catch (error) {
      status.textContent = error.message;
    }
  };
  apply.onclick = () => {
    if (!draft || !ready() || draft.baseline !== state.items || draft.version !== state.version) {
      clearDraft();
      status.textContent = 'O catálogo mudou ou está sincronizando. Revise a importação novamente.';
      return;
    }
    if (!save({...state,items:draft.items})) return;
    const summary = status.textContent;
    clearDraft();
    input.value = '';
    refresh();
    renderChecks();
    const monitor = setInterval(() => {
      if (!state.dirty && !byId('sync-cloud').disabled) {
        clearInterval(monitor);
        status.textContent = 'Catálogo sincronizado. '+summary;
      }
    },500);
    setTimeout(() => clearInterval(monitor),60000);
    status.textContent = 'Catálogo salvo neste aparelho. Aguardando sincronização. '+summary;
  };
})();
