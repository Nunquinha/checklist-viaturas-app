/* Pure catalog reconciliation. Server version checks remain authoritative. */
window.ChecklistCatalogSync = (() => {
  const fields = {vehicles:'prefix', items:'id', operators:'id'};
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
  const same = (a,b) => stable(a) === stable(b);
  function snapshot(catalog) {
    return Object.fromEntries(Object.keys(fields).map(key => [key,copy(catalog[key] || [])]));
  }
  function merge(base, local, remote) {
    const result = {version:remote.version}, conflicts = [];
    for (const [field,key] of Object.entries(fields)) {
      const old = new Map((base?.[field] || []).map(row => [row[key],row]));
      const pending = new Map((local[field] || []).map(row => [row[key],row]));
      const central = new Map((remote[field] || []).map(row => [row[key],row]));
      const merged = new Map([...central].map(([id,row]) => [id,copy(row)]));
      for (const id of new Set([...old.keys(),...pending.keys()])) {
        const before=old.get(id), next=pending.get(id), current=central.get(id);
        if (base && same(before,next)) continue;
        if (same(next,current)) continue;
        // Legacy drafts have no baseline: an absent row might have been deleted
        // centrally. Keep it pending for review rather than resurrecting it.
        if (!base || !same(before,current)) {
          conflicts.push({field,id,name:next?.name || next?.title || String(id)});
          continue;
        }
        if (next === undefined) merged.delete(id); else merged.set(id,copy(next));
      }
      // Concurrent additions of the same operator must not create duplicates.
      if (field === 'operators') {
        const names = new Map();
        for (const [id,row] of merged) {
          const name=String(row.name || '').trim().toLocaleLowerCase('pt-BR');
          const prior=names.get(name);
          if (!prior) { names.set(name,row); continue; }
          if (!old.has(id) && !old.has(prior.id)) {
            prior.vehicles=[...new Set([...(prior.vehicles || []),...(row.vehicles || [])])];
            merged.delete(id);
          } else conflicts.push({field,id,name:row.name});
        }
      }
      result[field]=[...merged.values()].map(copy);
    }
    return {catalog:result,conflicts};
  }
  return {snapshot,merge};
})();
