const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const clone=structuredClone,read=name=>fs.readFileSync(require('node:path').join(__dirname,'..',name),'utf8');
const initial=()=>({version:1,vehicles:[{prefix:'ITG-101',active:true}],items:[],operators:[{id:'existing',name:'Original',vehicles:['ITG-101']}]});
function server(){return {catalog:initial(),records:[],revoked:false,calls:[],hook:null,fail:false,
 async request(r){this.calls.push(r);if(this.fail)throw Error('network');if(this.revoked)return {ok:false,error:'Acesso expirado ou removido.'};
  let data;
  if(r.action==='bootstrap')data={user:r.user,catalog:r.body.version===this.catalog.version?null:clone(this.catalog)};
  else if(r.action==='catalog')data=clone(this.catalog);
  else if(r.action==='saveCatalog'){
   if(r.body.version!==this.catalog.version)return {ok:false,error:'Os cadastros mudaram em outro aparelho. Recarregue antes de editar.'};
   if(this.hook){const hook=this.hook;this.hook=null;await hook()}
   this.catalog={...clone(r.body),version:this.catalog.version+1};data=clone(this.catalog);
  }else if(r.action==='listRecords')data={records:this.records,cursor:0};
  else if(r.action==='saveRecord'){this.records.push(clone(r.body));data={id:r.body.record.id}}
  else throw Error(r.action);
  return {ok:true,data};
 }}}
function client(s,email,options={}){
 const role=options.role||'manager',user={email,role,admin:role==='owner'||role==='manager',owner:role==='owner',prefix:role==='vehicle'?'ITG-101':null};
 const session={user,token:email,expires:Date.now()+3600000},data=options.data||new Map();
 data.set('checklist-cloud-session-v1',JSON.stringify(session));
 const nodes=new Map(),events={},timers=[],intervals=[];
 const noop=()=>{},node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,elements:{role:{}},dataset:{},replaceChildren:noop,scrollIntoView:noop});return nodes.get(id)};
 const ctx={console,structuredClone,crypto:crypto.webcrypto,AbortSignal,Date,Map,Set,Blob,URL,
  navigator:{onLine:options.online!==false},document:{visibilityState:'visible',querySelector:()=>({content:'https://fake.invalid/api'}),querySelectorAll:()=>[],addEventListener:(n,f)=>events[n]=f},
  fetch:async(_url,request)=>{const r=JSON.parse(request.body);r.user=user;const response=await s.request(r);return {ok:true,json:async()=>response}},
  localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},
  byId:node,state:undefined,historyFilters:{},database:undefined,fields:{vehicle:{}},fortnightFields:{vehicle:{}},
  handover:{reset:noop},fortnight:{reset:noop},handoverStarted:null,fortnightStarted:null,incidentFields:{description:{value:''}},
  resetIncident:noop,resetIncidentHistoryFilters:noop,buildPads:noop,refreshFortnightPads:noop,refresh:noop,renderChecks:noop,page:noop,
  refreshFortnightChoices:noop,refreshIncidentChoices:noop,historyView:noop,refreshFortnightHistory:noop,refreshIncidentHistory:noop,
  inspections:async()=>[],incidents:async()=>[],removeEvidence:async()=>{},
  setTimeout:f=>(timers.push(f),timers.length),clearTimeout:noop,setInterval:f=>(intervals.push(f),intervals.length),
  addEventListener:(n,f)=>events[n]=f};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(read('catalog-sync.js'),ctx);vm.runInContext(read('cloud.js'),ctx);
 const key='checklist-cloud-data-v1:'+email+':'+(user.prefix||'')+':'+role;
 return {ctx,nodes,events,timers,intervals,data,key,
  sync:()=>node('sync-cloud').onclick(),
  add(name){const next={...ctx.state,operators:[...ctx.state.operators,{id:crypto.randomUUID(),name,vehicles:[]}]};ctx.checklistCloud.persist(ctx.state,next);ctx.state=next},
  saveFields(next){ctx.checklistCloud.persist(ctx.state,next);ctx.state=next}
 };
}
(async()=>{
 const s=server(),a=client(s,'a@test.invalid'),b=client(s,'b@test.invalid');
 await a.sync();await b.sync();a.ctx.navigator.onLine=false;b.ctx.navigator.onLine=false;a.add('Ana');b.add('Bruno');
 await a.sync();assert.equal(s.catalog.operators.length,1);assert.equal(JSON.parse(a.data.get(a.key)).dirty,true);
 a.ctx.navigator.onLine=true;await a.sync();b.ctx.navigator.onLine=true;await b.sync();
 assert.deepEqual(s.catalog.operators.map(r=>r.name).sort(),['Ana','Bruno','Original']);
 assert.equal(b.ctx.state.dirty,false);assert.equal(b.nodes.get('cloud-status').textContent,'Dados sincronizados');
 await a.sync();assert.equal(a.ctx.state.operators.length,3,'other account receives central additions');
 a.add('Carla');s.hook=async()=>a.add('Davi');await a.sync();assert.equal(a.ctx.state.dirty,true);assert.notEqual(a.nodes.get('cloud-status').textContent,'Dados sincronizados');
 await a.sync();assert.deepEqual(s.catalog.operators.map(r=>r.name).sort(),['Ana','Bruno','Carla','Davi','Original']);
 a.ctx.navigator.onLine=false;a.add('Eva');const reopened=client(s,'a@test.invalid',{data:a.data});
 assert(reopened.timers.length>0,'opening the app schedules sync');await reopened.sync();assert(s.catalog.operators.some(r=>r.name==='Eva'));
 for(const name of ['online','pageshow','focus'])assert.equal(typeof reopened.events[name],'function');
 assert.equal(typeof reopened.events.visibilitychange,'function');assert.equal(reopened.intervals.length,1);
 // A change to the same existing row must not silently replace another user's edit.
 const c=client(s,'c@test.invalid'),d=client(s,'d@test.invalid');await c.sync();await d.sync();
 c.saveFields({...c.ctx.state,operators:c.ctx.state.operators.map(r=>r.id==='existing'?{...r,name:'Central edit'}:r)});
 d.saveFields({...d.ctx.state,operators:d.ctx.state.operators.map(r=>r.id==='existing'?{...r,name:'Local edit'}:r)});
 await c.sync();await d.sync();assert.equal(s.catalog.operators.find(r=>r.id==='existing').name,'Central edit');
 assert.equal(d.ctx.state.dirty,true);assert.match(d.nodes.get('cloud-error').textContent,/alterações simultâneas/);
 // Network failure and revocation retain the saved draft and never mark it synchronized.
 const e=client(s,'e@test.invalid');await e.sync();e.add('Fábio');s.fail=true;await e.sync();
 assert.equal(JSON.parse(e.data.get(e.key)).dirty,true);assert.equal(e.nodes.get('cloud-status').textContent,'Sincronização pendente');
 s.fail=false;s.revoked=true;await e.sync();assert.equal(JSON.parse(e.data.get(e.key)).dirty,true);assert(!s.catalog.operators.some(r=>r.name==='Fábio'));
 assert.equal(e.data.has('checklist-cloud-session-v1'),false);
 // Restricted profiles cannot edit the shared catalog.
 for(const role of ['vehicle','viewer']){
  const restricted=client(server(),role+'@test.invalid',{role});await restricted.sync();
  assert.throws(()=>restricted.add('Forbidden'),/não pode atualizar cadastros/);
 }
 const engineer=client(server(),'engineer@test.invalid',{role:'engineer'});await engineer.sync();engineer.add('Engineer addition');await engineer.sync();assert.equal(engineer.ctx.state.dirty,false);
 console.log('PASS: shared accounts, offline persistence/reopen, reconnection triggers, concurrent additions, edits during upload, conflict preservation, failed network, revoked accounts and profile restrictions.');
})().catch(error=>{console.error(error);process.exitCode=1});
