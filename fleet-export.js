const ChecklistFleet = (() => {
  const bases = {'1':'Itapetininga','2':'Capão Bonito','4':'Itapeva','5':'Sorocaba','8':'Tatuí'};
  const collator = new Intl.Collator('pt-BR',{numeric:true});
  const base = prefix => /^ITG-\d{3}$/.test(prefix) ? prefix[4] : '';
  const name = code => bases[code] || (code ? 'Base '+code : 'Base não identificada');
  const selected = () => byId('fleet-base').value;
  const headers = ['Base','Prefixo','Placa','Tipo de serviço','Limite total (km)','km disponíveis'];
  const baseRank = code => code in bases ? Number(code) : 100 + (Number(code) || 0);

  function ordered(vehicles,filter='') {
    return vehicles.filter(vehicle=>!filter || base(vehicle.prefix)===filter).sort((a,b)=>
      baseRank(base(a.prefix))-baseRank(base(b.prefix)) || collator.compare(a.prefix,b.prefix));
  }

  function syncFilter(vehicles) {
    const select = byId('fleet-base'), previous = select.value;
    const codes = [...new Set(ordered(vehicles).map(vehicle=>base(vehicle.prefix)).filter(Boolean))];
    select.replaceChildren(new Option('Todas as bases',''),...codes.map(code=>new Option(name(code),code)));
    select.value = codes.includes(previous) ? previous : '';
  }

  function cells(vehicle,balance) {
    return [name(base(vehicle.prefix)),vehicle.prefix,vehicle.plate || '—',services[vehicle.prefix[5]] || '—',
      balance.budget?.limit ?? '—',balance.remaining ?? '—'];
  }

  async function pdf(rows,filter,table) {
    const response = await fetch('logo-der.jpg');
    if (!response.ok) throw Error('Logo DER indisponível.');
    const logo = new Uint8Array(await response.arrayBuffer());
    const doc = new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
    doc.setProperties({title:'Cadastro de viaturas por base - DER CGR.02',author:'DER - CGR.02'});
    const green = '#203d30', muted = '#56675d', columns = headers.slice(1);
    const x = [17,46,75,131,163];
    const now = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date());
    let y;
    function pageHeading() {
      doc.addImage(logo,'JPEG',14,12,21,16);
      doc.setFont('helvetica','bold').setTextColor(green).setFontSize(11);
      doc.text('DEPARTAMENTO DE ESTRADAS DE RODAGEM',40,18);
      doc.setFont('helvetica','normal').setFontSize(9).text('CGR.02 - Checklist de Viaturas',40,24);
      doc.setDrawColor(green).setLineWidth(.6).line(14,32,196,32);
      doc.setFont('helvetica','bold').setFontSize(17).text('Cadastro de viaturas por base',14,43);
      doc.setFont('helvetica','normal').setTextColor(muted).setFontSize(9);
      const active = rows.filter(vehicle=>vehicle.active).length;
      doc.text((filter?name(filter):'Todas as bases')+' | '+rows.length+' viaturas | '+active+' ativas | '+(rows.length-active)+' inativas',14,51);
      doc.text('Emitido em '+now+' | — indica valor indisponível',14,57);
      y=63;
    }
    function groupHeading(label) {
      doc.setFillColor(green).rect(14,y,182,8,'F');
      doc.setFont('helvetica','bold').setTextColor('#ffffff').setFontSize(10).text(label,17,y+5.5);
      y+=8;
      doc.setFillColor('#ebf0ec').rect(14,y,182,7,'F').setTextColor(green).setFontSize(9);
      columns.forEach((label,index)=>doc.text(label,x[index],y+4.8));
      y+=7;
    }
    pageHeading();
    let group;
    for (const [index,vehicle] of rows.entries()) {
      const current = base(vehicle.prefix);
      if (y+(current===group?8:26)>276) {
        doc.addPage();
        pageHeading();
        groupHeading(name(current)+(current===group?' (continuação)':''));
      } else if (current!==group) {
        if (group!==undefined) y+=3;
        groupHeading(name(current));
      }
      group=current;
      doc.setFont('helvetica','normal').setTextColor(green).setFontSize(9);
      table[index].slice(1).forEach((value,index)=>doc.text(typeof value==='number'?value.toLocaleString('pt-BR'):value,x[index],y+5.2));
      doc.setLineWidth(.15).setDrawColor('#dae2dc').line(14,y+8,196,y+8);
      y+=8;
    }
    const pages=doc.getNumberOfPages();
    for(let i=1;i<=pages;i++){
      doc.setPage(i).setDrawColor('#beccc3').line(14,282,196,282);
      doc.setFont('helvetica','normal').setTextColor(muted).setFontSize(8);
      doc.text('DER - CGR.02 | Cadastro de viaturas',14,287);
      doc.text(i+' / '+pages,196,287,{align:'right'});
    }
    return new Uint8Array(doc.output('arraybuffer'));
  }

  function mount() {
    byId('fleet-base').onchange=refresh;
    for (const format of ['pdf','excel']) {
      byId('fleet-'+format).onclick=async event=>{
        if (window.checklistCloud?.enabled && !window.checklistCloud.canOpen('viaturas')) return;
        const button=event.currentTarget, filter=selected(), rows=ordered(state.vehicles,filter);
        if (!rows.length) return alert('Nenhuma viatura cadastrada nesta base.');
        button.disabled=true;
        try {
          const isPdf = format==='pdf';
          const records = state.records || [];
          const confirmed = window.checklistCloud?.enabled ? records.filter(record=>record.cloudSaved===true) : records;
          const now = Date.now();
          const table = rows.map(vehicle=>cells(vehicle,ChecklistMileage.summarize(vehicle,confirmed,now)));
          const data = isPdf ? await pdf(rows,filter,table) : createWorkbook('Viaturas por base',headers,table);
          const type = isPdf?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          const date = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
          const url=URL.createObjectURL(new Blob([data],{type}));
          const link=document.createElement('a');
          link.href=url;link.download='DER-viaturas-'+(filter?'base-'+filter:'todas-as-bases')+'-'+date+(isPdf?'.pdf':'.xlsx');
          document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        } catch (error) { alert('Não foi possível gerar o arquivo: '+error.message); }
        finally { button.disabled=false; }
      };
    }
  }

  document.addEventListener('DOMContentLoaded',mount);
  return {base,name,selected,ordered,syncFilter};
})();

