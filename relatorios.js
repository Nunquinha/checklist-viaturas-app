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
  const fields=[['Viatura',record.prefix],['Data da vistoria',time(record.at)],['Quinzena',fortnightPeriod(record.at)],
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
  const tools=record.tools?.length?'<h2 class="report-section-title">Conferência de ferramental</h2><ul>'+
    record.tools.map(item=>'<li>'+escape(toolResultText(item))+'</li>').join('')+'</ul>'+
    (record.tools.some(item=>item.photo)?evidence('Fotos das pendências de ferramental',
      record.tools.filter(item=>item.photo).map(item=>figure(item.photo,item.title))):''):'';
  openReport('Checklist quinzenal · Vistoria individual',fields,
    notes+tools+evidence('Registro fotográfico',photos)+evidence('Assinaturas',signatures,'report-evidence-signatures'),trigger);
}

function itemIssues(record) {
  return (record.results||[]).filter(item=>isNonconforming(item.value)||
    (item.found!=null&&item.expected!=null&&item.found!==item.expected)).map(item=>{
    const count=item.found==null?'':item.expected==null?' ('+item.found+' encontrados)':' ('+item.found+' de '+item.expected+')';
    return item.title+count+(item.note?' — '+item.note:'');
  }).join(', ');
}

function reportRecord(record) {
  const date = time(record.inspected||record.exchange);
  const solo = isSoloChecklist(record);
  const names = solo?record.operator:[record.outgoing,record.incoming].filter(Boolean).join(' → ');
  const discrepancies = itemIssues(record);
  const details = [
    solo?'Checklist sozinho':null,
    record.reason&&(solo?'Justificativa: ':'Ausência: ')+record.reason,
    record.lateReason&&'Atraso: '+record.lateReason,
    discrepancies&&'Não conformidades: '+discrepancies
  ];
  return '<article class="report-record"><strong>'+escape(record.prefix)+' · '+date+'</strong>'+
    '<p>'+escape(names||'Operador não registrado')+' · '+duration(record.durationMs)+'</p>'+
    details.filter(Boolean).map(detail=>'<p>'+escape(detail)+'</p>').join('')+'</article>';
}

function fortnightReportDetails(record) {
  const tools = record.tools||[];
  const issues = tools.filter(toolHasIssue);
  const photos = Object.entries(photoLabels).map(([key,label])=>label+' '+(record.photos?.[key]?.length??0));
  const evidence = issues.filter(item=>item.photo).length;
  const status = !tools.length?'Sem conferência por item':issues.length?'Pendências registradas':'Itens conferidos em ordem';
  return '<article class="report-record fortnight-report-record"><div class="report-visit-head"><div><strong>'+
    escape(record.prefix)+' · '+time(record.at)+'</strong><p>'+escape(fortnightPeriod(record.at))+'</p></div>'+
    '<span class="report-visit-status'+(issues.length?' report-visit-issue':'')+'">'+status+'</span></div>'+
    '<dl class="report-visit-data"><div><dt>Operador</dt><dd>'+escape(record.operator||'Não registrado')+'</dd></div>'+
    '<div><dt>Duração</dt><dd>'+duration(record.durationMs)+'</dd></div>'+
    '<div><dt>Ferramental</dt><dd>'+(tools.length?tools.length+' conferidos · '+(tools.length-issues.length)+' em ordem · '+issues.length+' pendentes':'Sem itens registrados')+'</dd></div>'+
    '<div><dt>Fotos da vistoria</dt><dd>'+photos.join(' · ')+(evidence?' · '+evidence+' de pendências':'')+'</dd></div></dl>'+
    (issues.length?'<h4>Pendências de ferramental</h4><ul>'+issues.map(item=>'<li>'+escape(toolResultText(item))+'</li>').join('')+'</ul>':'')+
    (record.notes?'<p class="report-visit-notes"><strong>Observações</strong> '+escape(record.notes)+'</p>':'')+'</article>';
}

function fortnightVehicleSummary(records) {
  const groups = new Map();
  for (const record of records) {
    const period = fortnightPeriod(record.at);
    const key = JSON.stringify([record.prefix,period]);
    const row = groups.get(key)||{prefix:record.prefix,period,visits:0,attended:0,checked:0,issues:0};
    row.visits++;
    if (record.attended) row.attended++;
    if (record.tools?.length) {
      row.checked++;
      row.issues+=record.tools.filter(toolHasIssue).length;
    }
    groups.set(key,row);
  }
  return '<h2 class="report-section-title">Resumo por viatura e quinzena</h2><table class="report-visit-table">'+
    '<thead><tr><th>Viatura</th><th>Quinzena</th><th>Vistorias</th><th>Com engenheiro</th><th>Com ferramental conferido</th><th>Pendências registradas</th></tr></thead><tbody>'+
    [...groups.values()].sort((a,b)=>historyOrder.compare(a.prefix,b.prefix)).map(row=>
      '<tr><th scope="row">'+escape(row.prefix)+'</th><td>'+escape(row.period)+'</td><td>'+row.visits+'</td><td>'+row.attended+
      '</td><td>'+row.checked+' de '+row.visits+'</td><td>'+(row.checked?row.issues:'—')+'</td></tr>').join('')+'</tbody></table>';
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
      group.records.map(fortnightReportDetails).join('')).join('');
}

byId('prepare-report').onclick = async event => {
  if(window.checklistCloud?.canReport===false)return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const report = await selectedReport();
    const {daily,records,period,vehicle,operator,engineer,title} = report;
    const fields = [['Período',period],['Viatura',vehicle],['Operador',operator]];
    const stats = [[daily?'Registros':'Vistorias',records.length],['Tempo médio',reportDuration(records)]];
    if(!daily) {
      fields.push(['Engenheiro',engineer]);
      const attended = records.filter(record=>record.attended).length;
      const rate = records.length?(attended/records.length).toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1}):'—';
      stats.push(['Com engenheiro',attended+' de '+records.length+(records.length?' · '+rate:'')]);
      const checked = records.filter(record=>record.tools?.length);
      const tools = checked.flatMap(record=>record.tools);
      stats.push(['Viaturas vistoriadas',new Set(records.map(record=>record.prefix)).size],
        ['Com ferramental conferido',checked.length+' de '+records.length],
        ['Pendências de ferramental',tools.length?tools.filter(toolHasIssue).length:'—']);
    }
    const summary = '<div class="report-stats">'+stats.map(([label,value])=>'<div class="report-stat"><span>'+label+
      '</span><strong>'+escape(value)+'</strong></div>').join('')+'</div>';
    const details=!records.length?'<p>Nenhum registro nos filtros selecionados.</p>':daily?
      records.map(reportRecord).join(''):groupedFortnightRecords(records);
    const coverage = !daily&&records.length ? fortnightVehicleSummary(records) : '';
    openReport('Relatório de '+title.toLocaleLowerCase('pt-BR'),fields,
      summary+coverage+'<h2 class="report-section-title">'+(daily?'Registros do período':'Detalhamento por engenheiro')+'</h2>'+details,button);
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
      : ['Viatura','Vistoria','Operador','Duração (s)','Acompanhamento','Engenheiro','Observações','Quinzena','Ferramental conferido','Pendências de ferramental'];
    const seconds = record => Number.isFinite(record.durationMs)?Math.round(record.durationMs/1000):null;
    const rows = records.map(record=>daily ? [
      record.prefix,time(record.exchange),record.inspected?time(record.inspected):'',isSoloChecklist(record)?'':record.outgoing,
      record.incoming,isSoloChecklist(record)?record.operator:'',
      seconds(record),record.km===''||record.km==null?null:Number(record.km),record.fuel,
      record.reason,record.lateReason,itemIssues(record)
    ] : [record.prefix,time(record.at),record.operator,seconds(record),record.attended?'Sim':'Não',record.engineer,record.notes,
      fortnightPeriod(record.at),record.tools?.length??null,(record.tools||[]).filter(toolHasIssue).map(toolResultText).join('\n')]);
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
