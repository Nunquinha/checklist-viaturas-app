/* One shared ordering for the operator screen, Excel and PDF. */
window.ChecklistOperatorExport=(()=>{
  const collator=new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'});
  function ordered(list) {
    return list.map(operator=>{
      const vehicles=[...new Set(operator.vehicles || [])].sort(collator.compare);
      const bases=[...new Set(vehicles.filter(prefix=>/^ITG-\d{3}$/.test(prefix)).map(prefix=>prefix[4]))].sort(collator.compare);
      const base=bases.length===1?'Base '+bases[0]:bases.length?'Mais de uma base':'Sem vínculo com viatura';
      return {operator,name:String(operator.name || ''),vehicles,bases,base,rank:bases.length===1?Number(bases[0]):bases.length?100:101};
    }).sort((a,b)=>a.rank-b.rank || collator.compare(a.name,b.name));
  }
  function excel(list) {
    return createWorkbook('Operadores por base',['Base','Operador','Viaturas habituais'],
      ordered(list).map(row=>[row.bases.length>1?'Bases '+row.bases.join(', '):row.base,row.name,row.vehicles.join(', ')||'Sem vínculo']));
  }
  async function pdf(list,options={}) {
    const rows=ordered(list),now=options.now || new Date();
    const emitted=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(now);
    const logo=options.logo || new Uint8Array(await (await fetch('logo-der.jpg')).arrayBuffer());
    const doc=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
    doc.setProperties({title:'Cadastro de operadores por base - DER CGR.02',author:'DER - CGR.02',subject:'Operadores e viaturas habituais'});
    const green=[32,61,48],muted=[86,103,93];let y=0,group='';
    function heading(){
      doc.addImage(logo,'JPEG',14,12,21,16);
      doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(...green);
      doc.text('DEPARTAMENTO DE ESTRADAS DE RODAGEM',40,18);
      doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text('CGR.02 - Checklist de Viaturas',40,24);
      doc.setDrawColor(...green);doc.setLineWidth(.6);doc.line(14,32,196,32);
      doc.setFont('helvetica','bold');doc.setFontSize(17);doc.text('Cadastro de operadores por base',14,43);
      doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...muted);
      doc.text(rows.length+' operadores | '+rows.filter(row=>row.vehicles.length).length+' com viatura habitual | '+rows.filter(row=>!row.vehicles.length).length+' sem vínculo',14,51);
      doc.text('Emitido em '+emitted,14,57);y=63;
    }
    function groupHeading(label){
      doc.setFillColor(...green);doc.rect(14,y,182,8,'F');
      doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(255,255,255);doc.text(label,17,y+5.5);y+=8;
      doc.setFillColor(235,240,236);doc.rect(14,y,182,7,'F');doc.setTextColor(...green);doc.setFontSize(9);
      doc.text('Operador',17,y+4.8);doc.text('Viaturas habituais',138,y+4.8);y+=7;
    }
    heading();
    for(const row of rows){
      doc.setFont('helvetica','normal');doc.setFontSize(9.5);
      const names=doc.splitTextToSize(row.name,114),links=doc.splitTextToSize(row.vehicles.join(', ')||'Sem vínculo',55);
      const height=Math.max(7.5,Math.max(names.length,links.length)*4.2+3);
      const changed=group!==row.base;
      if(y+height+(changed?17:0)>275){doc.addPage();heading();groupHeading(row.base+(changed?'':' (continuação)'));group=row.base}
      else if(changed){if(group)y+=3;groupHeading(row.base);group=row.base}
      doc.setFont('helvetica','normal');doc.setFontSize(9.5);doc.setTextColor(...green);
      doc.text(names,17,y+5);doc.text(links,138,y+5);
      doc.setDrawColor(218,226,220);doc.setLineWidth(.15);doc.line(14,y+height,196,y+height);y+=height;
    }
    if(!rows.length){doc.setFontSize(11);doc.text('Nenhum operador cadastrado.',14,77)}
    const pages=doc.getNumberOfPages();
    for(let n=1;n<=pages;n++){
      doc.setPage(n);doc.setDrawColor(190,204,195);doc.line(14,282,196,282);
      doc.setTextColor(...muted);doc.setFont('helvetica','normal');doc.setFontSize(8);
      doc.text('DER - CGR.02 | Cadastro de operadores',14,287);doc.text(n+' / '+pages,196,287,{align:'right'});
    }
    return new Uint8Array(doc.output('arraybuffer'));
  }
  function download(bytes,type,name){
    const url=URL.createObjectURL(new Blob([bytes],{type})),link=document.createElement('a');
    link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function mount(){
    const excelButton=byId('operators-excel'),pdfButton=byId('operators-pdf');if(!excelButton || !pdfButton)return;
    const run=kind=>async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{
        if(window.checklistCloud?.enabled && !window.checklistCloud.canOpen('operadores'))throw Error('Entre com uma conta autorizada a consultar os operadores.');
        const list=structuredClone(operators());if(!list.length)throw Error('Nenhum operador cadastrado.');
        const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
        if(kind==='excel')download(excel(list),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','DER-operadores-por-base-'+date+'.xlsx');
        else download(await pdf(list),'application/pdf','DER-operadores-por-base-'+date+'.pdf');
      }catch(failure){alert('Não foi possível gerar o arquivo: '+failure.message)}finally{button.disabled=false}
    };
    excelButton.onclick=run('excel');pdfButton.onclick=run('pdf');renderOperatorAdmin();
  }
  return {ordered,excel,pdf,mount};
})();
ChecklistOperatorExport.mount();

