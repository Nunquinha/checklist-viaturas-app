/* Vehicle limits and the authenticated fleet balance view. */
window.ChecklistMileageUI=(()=>{
  const names=['kmLimit','kmStart','kmEnd','kmInitial'];
  const form=byId('fleet'),enabled=byId('km-budget-enabled'),inputs=Object.fromEntries(names.map(name=>[name,form.elements[name]]));
  const number=new Intl.NumberFormat('pt-BR');
  const display=value=>value===null?'—':number.format(value)+' km';
  const day=value=>value?value.split('-').reverse().join('/'):'Sem data final';
  function toggle(){
    byId('km-budget-fields').hidden=!enabled.checked;
    for(const [name,input] of Object.entries(inputs)){input.disabled=!enabled.checked;input.required=enabled.checked&&name!=='kmEnd'}
  }
  function fill(vehicle){
    const value=vehicle?.kmBudget;enabled.checked=!!value;
    inputs.kmLimit.value=value?.limit??'';inputs.kmInitial.value=value?.initial??'';
    inputs.kmStart.value=value?.start||'';inputs.kmEnd.value=value?.end||'';toggle();
  }
  function read(){
    if(!enabled.checked)return null;
    const value={limit:inputs.kmLimit.value,initial:inputs.kmInitial.value,start:inputs.kmStart.value,end:inputs.kmEnd.value};
    const checked=ChecklistMileage.config(value);
    return {limit:checked.limit,initial:checked.initial,start:checked.start,end:checked.end};
  }
  function render(){
    const target=byId('km-balance-rows');if(!target)return;
    const source=window.checklistCloud?.enabled?(state.records||[]).filter(row=>row.cloudSaved===true):(state.records||[]);
    const scope=window.checklistCloud?.vehicle;
    const vehicles=(state.vehicles||[]).filter(row=>!scope||row.prefix===scope);
    const rows=ChecklistMileage.fleet(vehicles,source),query=byId('km-balance-search').value.trim().toUpperCase();
    const visible=rows.filter(row=>(row.prefix+' '+row.plate).toUpperCase().includes(query));
    target.innerHTML=visible.map(row=>'<tr><td><strong>'+escape(row.prefix)+'</strong><small>'+escape(row.plate)+'</small></td>'+
      '<td>'+escape(row.budget?day(row.budget.start)+' a '+day(row.budget.end):'—')+'</td>'+
      '<td>'+display(row.budget?.limit??null)+'</td><td>'+display(row.used)+'</td>'+
      '<td><strong>'+display(row.remaining)+'</strong></td><td><span class="km-status km-'+row.status+'">'+escape(row.label)+'</span>'+
      (row.closed?'<small>Período encerrado</small>':'')+(row.issues.length?'<small>'+escape(row.issues[0])+'</small>':'')+
      (row.lastKm!==null?'<small>Última leitura: '+display(row.lastKm)+'</small>':'')+'</td></tr>').join('')||'<tr><td colspan="6">Nenhuma viatura encontrada.</td></tr>';
    byId('km-balance-summary').textContent=rows.filter(row=>row.budget).length+' viaturas com controle de KM configurado · '+
      rows.filter(row=>row.remaining!==null&&row.remaining<=0).length+' com limite atingido ou excedido.';
  }
  enabled.onchange=toggle;byId('km-balance-search').oninput=render;fill();render();
  return {fill,read,render,reset:()=>fill()};
})();
