/* Recompute from immutable daily readings: no incremental debit can run twice. */
(function(root){
  const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
  function whole(value){
    if(typeof value!=='number'&&typeof value!=='string')return null;
    if(value===null || value===undefined || String(value).trim()==='')return null;
    const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:null;
  }
  function dateStart(day){
    if(!dayPattern.test(String(day||'')))return null;
    const at=Date.parse(day+'T00:00:00-03:00');
    const valid=Number.isFinite(at)&&new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date(at))===day;
    return valid?at:null;
  }
  function config(value){
    if(!value)return null;
    const limit=whole(value.limit),initial=whole(value.initial),start=dateStart(value.start),end=value.end?dateStart(value.end):null;
    if(limit===null || limit===0 || initial===null || start===null || (value.end&&(end===null||end<start)))
      throw Error('Confira o limite, o odômetro inicial e as datas do controle de KM.');
    return {limit,initial,start:value.start,end:value.end||'',from:start,until:end===null?Infinity:end+86400000};
  }
  function readingAt(record){
    const raw=record.inspected || record.exchange || record.at;
    const at=typeof raw==='number'?raw:Date.parse(raw);return Number.isFinite(at)?at:null;
  }
  function summarize(vehicle,records,now=Date.now()){
    const empty={prefix:vehicle.prefix,plate:vehicle.plate||'',budget:null,used:null,remaining:null,lastKm:null,lastAt:null,readings:0,issues:[]};
    let budget;
    try{budget=config(vehicle.kmBudget)}catch(error){return {...empty,status:'invalid',label:'Revisar configuração',issues:[error.message]}}
    if(!budget)return {...empty,status:'unconfigured',label:'Sem limite configurado'};
    const result={...empty,budget};
    if(now<budget.from)return {...result,status:'future',label:'Período ainda não iniciado'};
    const unique=new Map();
    for(const row of records){
      if(row.prefix!==vehicle.prefix)continue;
      const at=readingAt(row);if(at===null || at<budget.from || at>=budget.until || at>now)continue;
      if(row.mode==='deferred' && whole(row.km)===null)continue;
      const id=row.id||JSON.stringify([row.prefix,at,row.km]);
      const prior=unique.get(id);
      if(prior && (whole(prior.km)!==whole(row.km) || readingAt(prior)!==at))result.issues.push('Registro repetido com leituras diferentes.');
      else unique.set(id,row);
    }
    const ordered=[...unique.values()].sort((a,b)=>readingAt(a)-readingAt(b)||String(a.id||'').localeCompare(String(b.id||'')));
    let last=budget.initial;
    for(const row of ordered){
      const km=whole(row.km),at=readingAt(row);
      if(km===null){result.issues.push('Há um checklist com odômetro ausente ou inválido.');continue}
      if(km<last){result.issues.push('Há uma leitura menor que o odômetro anterior.');continue}
      last=km;result.lastKm=km;result.lastAt=at;result.readings++;
    }
    if(result.issues.length)return {...result,status:'review',label:'Revisar leituras'};
    if(!result.readings)return {...result,status:'awaiting',label:'Aguardando primeiro checklist'};
    const used=last-budget.initial,remaining=budget.limit-used;
    const status=remaining<0?'exceeded':remaining===0?'exhausted':remaining<=budget.limit*.1?'low':'available';
    const labels={exceeded:'Limite excedido',exhausted:'Limite atingido',low:'Saldo baixo',available:'Disponível'};
    return {...result,used,remaining,status,label:labels[status],closed:now>=budget.until};
  }
  function fleet(vehicles,records,now=Date.now()){
    return vehicles.filter(row=>row.active!==false).map(row=>summarize(row,records,now))
      .sort((a,b)=>a.prefix.localeCompare(b.prefix,'pt-BR',{numeric:true}));
  }
  const api={whole,config,summarize,fleet,readingAt};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.ChecklistMileage=api;
})(typeof window==='undefined'?null:window);
