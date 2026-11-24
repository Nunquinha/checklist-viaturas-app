const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const ctx={structuredClone,crypto:crypto.webcrypto,byId:()=>null};ctx.window=ctx;vm.createContext(ctx);
for(const file of ['catalog-sync.js','operators-import.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
const merge=ctx.ChecklistCatalogSync.merge;
const base={vehicles:[],items:[],operators:[{id:'a',name:'Ana',vehicles:[]}]};
const remote={...structuredClone(base),version:3};
const local={...structuredClone(base),operators:[...base.operators,{id:'b',name:'Bruno',vehicles:[]}]};
remote.operators.push({id:'c',name:'Carla',vehicles:[]});
const before=JSON.stringify(remote),result=merge(base,local,remote);
assert.equal(result.conflicts.length,0);assert.equal(result.catalog.operators.length,3);assert.equal(JSON.stringify(remote),before);
const deleted={...structuredClone(base),operators:[]};assert.equal(merge(base,deleted,{...base,version:4}).catalog.operators.length,0);
const concurrentDelete={...base,operators:[],version:4};
const edited={...base,operators:[{id:'a',name:'Ana editada',vehicles:[]}]};assert.equal(merge(base,edited,concurrentDelete).conflicts.length,1);
const duplicate=merge({vehicles:[],items:[],operators:[]},
 {vehicles:[],items:[],operators:[{id:'local',name:'Ana',vehicles:['ITG-101']}]},
 {version:2,vehicles:[],items:[],operators:[{id:'central',name:'Ana',vehicles:['ITG-121']}]});
assert.equal(duplicate.catalog.operators.length,1);assert.equal(duplicate.catalog.operators[0].vehicles.length,2);
const legacy=merge(undefined,local,remote);assert.equal(legacy.conflicts.length,1);assert.equal(legacy.catalog.operators.length,2);
const plan=ctx.ChecklistOperatorImport.plan;
const input={format:'checklist-operators-v1',operators:[{name:'Novo',vehicles:['ITG-101','ITG-172']},{name:'  Existente ',vehicles:[]}]};
const imported=plan(input,[{id:'old',name:'existente',vehicles:[]}],[{prefix:'ITG-101'}]);
assert.equal(imported.added.length,1);assert.equal(imported.skipped,1);assert.deepEqual([...imported.unknown],['ITG-172']);assert.equal(imported.added[0].vehicles.length,1);
assert.throws(()=>plan({...input,operators:[{name:'Inválido',vehicles:['BAD']}]},[],[]),/Prefixo inválido/);
console.log('PASS: catalog merges, deletion/edit conflicts, no mutation, duplicate concurrent additions, legacy drafts, operator import deduplication and unmapped prefixes.');
