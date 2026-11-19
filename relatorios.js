const historyControls = {from:byId('history-from'),to:byId('history-to'),
  vehicle:byId('history-vehicle'),operator:byId('history-operator')};
const historyFilters = {daily:{},fortnight:{}};
const historyDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'});
const historyOrder = new Intl.Collator('pt-BR',{numeric:true});
const recordedOperators = (record,kind) => kind==='daily'?[record.outgoing,record.incoming]:[record.operator];

function switchHistory(kind) {
  historyKind = kind;
  for (const key of ['from','to']) historyControls[key].value = historyFilters[kind][key] || '';
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
}

function historyIncludes(record,kind,filters=historyFilters[kind]) {
  const {from,to,vehicle,operator} = filters;
  const date = kind==='daily'?record.inspected||record.exchange:record.at;
  const day = (from||to)?historyDay.format(new Date(date)):'';
  return (!from||day>=from) && (!to||day<=to) && (!vehicle||record.prefix===vehicle) &&
    (!operator||recordedOperators(record,kind).includes(operator));
}

for (const [key,control] of Object.entries(historyControls)) {
  control.onchange = () => {
    historyFilters[historyKind][key] = control.value;
    if(historyKind==='daily') historyView(); else refreshFortnightHistory();
  };
}

function reportDuration(records) {
  const values = records.map(record=>record.durationMs).filter(Number.isFinite);
  return duration(values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null);
}

async function selectedReport() {
  const kind = historyKind, filters = {...historyFilters[kind]}, daily = kind==='daily';
  const all = daily?state.records:(await inspections()).reverse();
  const records = all.filter(record=>historyIncludes(record,kind,filters));
  const {from,to,vehicle,operator} = filters;
  const formattedDate = value => value.split('-').reverse().join('/');
  const period = [from?'De '+formattedDate(from):'',to?'Até '+formattedDate(to):''].filter(Boolean).join(' · ') || 'Todo o período disponível';
  return {daily,records,period,vehicle:vehicle||'Todas',operator:operator||'Todos',
    title:daily?'Trocas de turno':'Vistorias quinzenais'};
}

function quantityDifferences(record) {
  return (record.results||[]).filter(item=>item.found!=null&&item.found!==item.expected)
    .map(item=>item.title+' ('+item.found+' de '+item.expected+')'+(item.note?' — '+item.note:'')).join(', ');
}

function reportRecord(record,daily) {
  const date = time(daily?record.inspected||record.exchange:record.at);
  const names = daily?[record.outgoing,record.incoming].filter(Boolean).join(' → '):record.operator;
  const discrepancies = daily?quantityDifferences(record):'';
  const details = daily ? [
    record.reason&&'Ausência: '+record.reason,
    record.lateReason&&'Atraso: '+record.lateReason,
    discrepancies&&'Diferenças: '+discrepancies
  ] : [record.attended?'Engenheiro: '+record.engineer:'Sem acompanhamento do engenheiro', record.notes];
  return '<article class="report-record"><strong>'+escape(record.prefix)+' · '+date+'</strong>'+
    '<p>'+escape(names||'Operador não registrado')+' · '+duration(record.durationMs)+'</p>'+
    details.filter(Boolean).map(detail=>'<p>'+escape(detail)+'</p>').join('')+'</article>';
}

byId('prepare-report').onclick = async event => {
  if(window.checklistCloud?.canReport===false)return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const report = await selectedReport();
    const {daily,records,period,vehicle,operator,title} = report;
    const logo = document.querySelector('.brand img').src;
    const fields = [['Período',period],['Viatura',vehicle],['Operador',operator],['Emitido em',time(Date.now())]];
    const stats = [['Registros',records.length],['Tempo médio',reportDuration(records)]];
    if(!daily) {
      const attended = records.filter(record=>record.attended).length;
      const rate = records.length?(attended/records.length).toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:1}):'—';
      stats.push(['Com engenheiro',attended+' de '+records.length+(records.length?' · '+rate:'')]);
    }
    byId('report-content').innerHTML =
      '<header class="report-heading"><img src="'+escape(logo)+'" alt="Logo do DER"><div>'+
      '<div class="report-eyebrow">DER · CGR.02 | Checklist de Viaturas</div><h1>Relatório de '+title.toLocaleLowerCase('pt-BR')+'</h1></div></header>'+
      '<dl class="report-metadata">'+fields.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl>'+
      '<div class="report-stats">'+stats.map(([label,value])=>'<div class="report-stat"><span>'+label+'</span><strong>'+escape(value)+'</strong></div>').join('')+'</div>'+
      '<h2 class="report-section-title">Registros do período</h2>'+
      (records.length?records.map(record=>reportRecord(record,daily)).join(''):'<p>Nenhum registro nos filtros selecionados.</p>')+
      '<footer class="report-footer">DER · CGR.02 · Checklist de Viaturas</footer>';
    byId('shell').hidden = true;
    byId('report-print').hidden = false;
    document.body.classList.add('reporting');
    window.scrollTo(0,0);
    byId('print-report').focus();
  } catch {
    byId('notice').textContent = 'Não foi possível preparar o relatório. Tente novamente.';
  } finally { button.disabled = false; }
};

byId('close-report').onclick = () => {
  byId('report-print').hidden = true;
  document.body.classList.remove('reporting');
  byId('shell').hidden = false;
  byId('prepare-report').focus();
};
byId('print-report').onclick = () => window.print();

byId('export-excel').onclick = async event => {
  if(window.checklistCloud?.canReport===false)return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const {daily,records,title} = await selectedReport();
    const headers = daily
      ? ['Viatura','Troca','Conferência','Quem entregou','Quem recebeu','Duração (s)','Quilometragem','Combustível','Ausência','Atraso','Diferenças']
      : ['Viatura','Vistoria','Operador','Duração (s)','Acompanhamento','Engenheiro','Observações'];
    const seconds = record => Number.isFinite(record.durationMs)?Math.round(record.durationMs/1000):null;
    const rows = records.map(record=>daily ? [
      record.prefix,time(record.exchange),record.inspected?time(record.inspected):'',record.outgoing,record.incoming,
      seconds(record),record.km===''||record.km==null?null:Number(record.km),record.fuel,
      record.reason,record.lateReason,quantityDifferences(record)
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
