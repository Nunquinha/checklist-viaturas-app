const historyControls = {from:byId('history-from'),to:byId('history-to'),
  vehicle:byId('history-vehicle'),operator:byId('history-operator'),engineer:byId('history-engineer')};
const historyFilters = {daily:{},fortnight:{}};
const historyDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'});
const historyOrder = new Intl.Collator('pt-BR',{numeric:true});
const recordedOperators = (record,kind) => kind==='daily'&&!isSoloChecklist(record)?[record.outgoing,record.incoming]:[record.operator];
const noEngineer = 'Sem acompanhamento';
const engineerKey = record => record.attended&&record.engineer?.trim()?record.engineer.trim().toLocaleLowerCase('pt-BR'):'';
const engineerLabel = record => engineerKey(record)?record.engineer.trim():noEngineer;
let reportTrigger;

function switchHistory(kind) {
  historyKind = kind;
  byId('history-engineer-field').hidden=kind==='daily';
  byId('prepare-report').textContent=kind==='daily'?'Gerar relatório PDF':'PDF consolidado';
  for (const key of ['from','to']) historyControls[key].value = historyFilters[kind][key] || '';
  byId('clear-history-filters').hidden=!Object.values(historyFilters[kind]).some(Boolean);
}

function refreshHistoryOptions(kind,records) {
  if(kind!==historyKind) return;
  const options = {
    vehicle:[...state.vehicles.map(row=>row.prefix),...records.map(row=>row.prefix)],
    operator:[...operators().map(row=>row.name),...records.flatMap(row=>recordedOperators(row,kind))]
  };
  for (const [key,all] of Object.entries(options)) {
    const select = historyControls[key], selection = historyFilters[kind][key] || '';
    const values = [...new Set([...all,selection].filter(Boolean))].sort(historyOrder.compare);
    select.replaceChildren(new Option(key==='vehicle'?'Todas as viaturas':'Todos os operadores',''),
      ...values.map(value=>new Option(value,value)));
    select.value = selection;
  }
  if(kind==='fortnight') {
    const names = new Map(records.filter(engineerKey).map(record=>[engineerKey(record),engineerLabel(record)]));
    const selection=historyFilters.fortnight.engineer||'';
    historyControls.engineer.replaceChildren(new Option('Todos os engenheiros',''),new Option(noEngineer,'!'),
      ...[...names].sort((a,b)=>historyOrder.compare(a[1],b[1])).map(([key,name])=>new Option(name,key)));
    historyControls.engineer.value=selection;
  }
}

function historyIncludes(record,kind,filters=historyFilters[kind]) {
  const {from,to,vehicle,operator,engineer} = filters;
  const date = kind==='daily'?record.inspected||record.exchange:record.at;
  const day = (from||to)?historyDay.format(new Date(date)):'';
  return (!from||day>=from) && (!to||day<=to) && (!vehicle||record.prefix===vehicle) &&
    (!operator||recordedOperators(record,kind).includes(operator)) &&
    (kind==='daily'||!engineer||(engineer==='!'?!engineerKey(record):engineerKey(record)===engineer));
}

function redrawHistory() {
  byId('clear-history-filters').hidden=!Object.values(historyFilters[historyKind]).some(Boolean);
  if(historyKind==='daily') historyView(); else refreshFortnightHistory();
}
for (const [key,control] of Object.entries(historyControls)) {
  control.onchange = () => {
    historyFilters[historyKind][key] = control.value;
    redrawHistory();
  };
}
byId('clear-history-filters').onclick=()=>{
  historyFilters[historyKind]={};
  switchHistory(historyKind);
  redrawHistory();
};

function reportDuration(records) {
  const values = records.map(record=>record.durationMs).filter(Number.isFinite);
  return duration(values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null);
}

async function selectedReport() {
  const kind = historyKind, filters = {...historyFilters[kind]}, daily = kind==='daily';
  const all = daily?state.records:(await inspections()).reverse();
  const records = all.filter(record=>historyIncludes(record,kind,filters));
  const {from,to,vehicle,operator,engineer} = filters;
  const person = engineer && all.find(record=>engineer===engineerKey(record));
  const formattedDate = value => value.split('-').reverse().join('/');
  const period = [from?'De '+formattedDate(from):'',to?'Até '+formattedDate(to):''].filter(Boolean).join(' · ') || 'Todo o período disponível';
  return {daily,records,period,vehicle:vehicle||'Todas',operator:operator||'Todos',
    engineer:engineer==='!'?noEngineer:person?engineerLabel(person):'Todos',
    title:daily?'Trocas de turno':'Vistorias quinzenais'};
}

function openReport(title,fields,sections,trigger) {
  if(window.checklistCloud?.canReport===false)return;
  const logo=document.querySelector('.brand img').src;
  reportTrigger=trigger;
  byId('report-content').innerHTML =
    '<header class="report-heading"><img src="'+escape(logo)+'" alt="Logo do DER"><div>'+
    '<div class="report-eyebrow">DER · CGR.02 | Checklist de Viaturas</div><h1>'+escape(title)+'</h1></div></header>'+
    '<dl class="report-metadata">'+[...fields,['Emitido em',time(Date.now())]].map(([label,value])=>
      '<div><dt>'+label+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl>'+sections+
    '<footer class="report-footer">DER · CGR.02 · Checklist de Viaturas</footer>';
  byId('shell').hidden=true;
  byId('report-print').hidden=false;
  document.body.classList.add('reporting');
  window.scrollTo(0,0);
  const print=byId('print-report');
  const images=[...byId('report-content').querySelectorAll('img')];
  print.disabled=images.some(image=>!image.complete);
  if(print.disabled)Promise.allSettled(images.map(image=>image.decode())).then(()=>{
    if(reportTrigger===trigger)print.disabled=false;
  });
  byId('close-report').focus();
}

function showIndividualFortnightReport(record,trigger) {
  if(!record||window.checklistCloud?.canReport===false)return;
  const fields=[['Viatura',record.prefix],['Data da vistoria',time(record.at)],
    ['Operador',record.operator],['Engenheiro',engineerLabel(record)],['Duração',duration(record.durationMs)]];
  const figure = (source,label) => '<figure><img src="'+escape(source)+'" alt="'+escape(label)+'"><figcaption>'+
    escape(label)+'</figcaption></figure>';
  const photos=Object.entries(record.photos||{}).flatMap(([key,images])=>images.map((source,index)=>
    figure(source,(photoLabels[key]||'Foto da vistoria')+(images.length>1?' · '+(index+1):''))));
  const signatures=Object.entries(record.signatures||{}).map(([role,source])=>figure(source,
    role==='engineer'?'Assinatura do engenheiro':'Assinatura do operador'));
  const evidence = (title,items,classes='') => '<h2 class="report-section-title">'+title+'</h2>'+
    (items.length?'<div class="report-evidence '+classes+'">'+items.join('')+'</div>':'<p>Sem registros.</p>');
  const notes=record.notes?'<h2 class="report-section-title">Observações</h2><p>'+escape(record.notes)+'</p>':'';
  openReport('Checklist quinzenal · Vistoria individual',fields,
    notes+evidence('Registro fotográfico',photos)+evidence('Assinaturas',signatures,'report-evidence-signatures'),trigger);
}

function itemIssues(record) {
  return (record.results||[]).filter(item=>isNonconforming(item.value)||
    (item.found!=null&&item.expected!=null&&item.found!==item.expected)).map(item=>{
    const count=item.found==null?'':item.expected==null?' ('+item.found+' encontrados)':' ('+item.found+' de '+item.expected+')';
    return item.title+count+(item.note?' — '+item.note:'');
  }).join(', ');
}

function reportRecord(record,daily,grouped=false) {
  const date = time(daily?record.inspected||record.exchange:record.at);
  const solo = daily&&isSoloChecklist(record);
  const names = daily&&!solo?[record.outgoing,record.incoming].filter(Boolean).join(' → '):record.operator;
  const discrepancies = daily?itemIssues(record):'';
  const details = daily ? [
    solo?'Checklist sozinho':null,
    record.reason&&(solo?'Justificativa: ':'Ausência: ')+record.reason,
    record.lateReason&&'Atraso: '+record.lateReason,
    discrepancies&&'Não conformidades: '+discrepancies
  ] : [!grouped&&engineerLabel(record),record.notes];
  return '<article class="report-record"><strong>'+escape(record.prefix)+' · '+date+'</strong>'+
    '<p>'+escape(names||'Operador não registrado')+' · '+duration(record.durationMs)+'</p>'+
    details.filter(Boolean).map(detail=>'<p>'+escape(detail)+'</p>').join('')+'</article>';
}

function groupedFortnightRecords(records) {
  const groups=new Map();
  for(const record of records){
    const key=engineerKey(record);
    if(!groups.has(key))groups.set(key,{label:engineerLabel(record),records:[]});
    groups.get(key).records.push(record);
  }
  return [...groups.entries()].sort(([a,left],[b,right])=>!a?1:!b?-1:historyOrder.compare(left.label,right.label))
    .map(([,group])=>'<h3 class="report-people">'+escape(group.label)+' · '+group.records.length+
      (group.records.length===1?' vistoria':' vistorias')+'</h3>'+
      group.records.map(record=>reportRecord(record,false,true)).join('')).join('');
}

byId('prepare-report').onclick = async event => {
  if(window.checklistCloud?.canReport===false)return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const report = await selectedReport();
    const {daily,records,period,vehicle,operator,engineer,title} = report;
    const fields = [['Período',period],['Viatura',vehicle],['Operador',operator]];
    const stats = [['Registros',records.length],['Tempo médio',reportDuration(records)]];
    if(!daily) {
      fields.push(['Engenheiro',engineer]);
      const attended = records.filter(record=>record.attended).length;
      const rate = records.length?(attended/records.length).toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1}):'—';
      stats.push(['Com engenheiro',attended+' de '+records.length+(records.length?' · '+rate:'')]);
    }
    const summary = '<div class="report-stats">'+stats.map(([label,value])=>'<div class="report-stat"><span>'+label+
      '</span><strong>'+escape(value)+'</strong></div>').join('')+'</div>';
    const details=!records.length?'<p>Nenhum registro nos filtros selecionados.</p>':daily?
      records.map(record=>reportRecord(record,true)).join(''):groupedFortnightRecords(records);
    openReport('Relatório de '+title.toLocaleLowerCase('pt-BR'),fields,
      summary+'<h2 class="report-section-title">'+(daily?'Registros do período':'Vistorias por engenheiro')+'</h2>'+details,button);
  } catch {
    byId('notice').textContent = 'Não foi possível preparar o relatório. Tente novamente.';
  } finally { button.disabled = false; }
};

byId('close-report').onclick = () => {
  byId('report-print').hidden = true;
  document.body.classList.remove('reporting');
  byId('shell').hidden = false;
  (reportTrigger?.isConnected?reportTrigger:byId('prepare-report')).focus();
  reportTrigger=undefined;
};
byId('print-report').onclick = () => window.print();

byId('export-excel').onclick = async event => {
  if(window.checklistCloud?.canExportExcel===false)return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const {daily,records,title} = await selectedReport();
    const headers = daily
      ? ['Viatura','Troca','Conferência','Quem entregou','Quem recebeu','Operador (sozinho)','Duração (s)','Quilometragem','Combustível','Justificativa','Atraso','Não conformidades']
      : ['Viatura','Vistoria','Operador','Duração (s)','Acompanhamento','Engenheiro','Observações'];
    const seconds = record => Number.isFinite(record.durationMs)?Math.round(record.durationMs/1000):null;
    const rows = records.map(record=>daily ? [
      record.prefix,time(record.exchange),record.inspected?time(record.inspected):'',isSoloChecklist(record)?'':record.outgoing,
      record.incoming,isSoloChecklist(record)?record.operator:'',
      seconds(record),record.km===''||record.km==null?null:Number(record.km),record.fuel,
      record.reason,record.lateReason,itemIssues(record)
    ] : [record.prefix,time(record.at),record.operator,seconds(record),record.attended?'Sim':'Não',record.engineer,record.notes]);
    const bytes = createWorkbook(title,headers,rows);
    const url = URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = (daily?'checklist-trocas':'checklist-quinzenal')+'-'+historyDay.format(new Date())+'.xlsx';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  } catch {
    byId('notice').textContent = 'Não foi possível gerar o Excel. Tente novamente.';
  } finally { button.disabled = false; }
};
