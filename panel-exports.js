/* Exports the currently filtered KM table; no additional account data is fetched. */
window.ChecklistPanelExport=(()=>{
  const headers=['Viatura','Período do limite','Limite (km)','Rodados (km)','Disponíveis (km)','Situação'];
  function pdf(rows,filters,logo){
    const doc=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
    const widths=[25,51,30,30,31,102],left=14;let y=0;
    const emitted=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date());
    doc.setProperties({title:'KM disponível por viatura - DER',author:'DER'});
    function heading(){
      if(logo)doc.addImage(logo,'JPEG',14,10,20,16);
      doc.setTextColor(32,61,48);doc.setFont('helvetica','bold');doc.setFontSize(12);
      doc.text('DER / SP - CONTROLE DE QUILOMETRAGEM',40,17);
      doc.setFontSize(17);doc.text('KM disponível por viatura',40,26);
      doc.setFont('helvetica','normal');doc.setFontSize(9);
      doc.text('Emitido em '+emitted+' | '+rows.length+' viaturas',14,36);
      doc.text(doc.splitTextToSize(filters,265).slice(0,2),14,42);
      y=53;doc.setFillColor(32,61,48);doc.rect(left,y,269,9,'F');doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');
      let x=left;headers.forEach((h,i)=>{doc.text(h,x+2,y+6);x+=widths[i]});y+=9;
    }
    heading();
    rows.forEach((row,index)=>{
      doc.setFont('helvetica','normal');doc.setFontSize(9);
      const lines=row.map((v,i)=>doc.splitTextToSize(String(v),widths[i]-4));
      const height=Math.max(11,...lines.map(v=>v.length*4+5));
      if(y+height>190){doc.addPage();heading()}
      doc.setFillColor(...(index%2?[241,246,243]:[255,255,255]));doc.rect(left,y,269,height,'F');
      doc.setTextColor(32,61,48);let x=left;lines.forEach((v,i)=>{doc.text(v,x+2,y+5);x+=widths[i]});
      doc.setDrawColor(210,223,215);doc.line(left,y+height,283,y+height);y+=height;
    });
    const count=doc.getNumberOfPages();for(let i=1;i<=count;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(86,103,93);doc.text('DER / SP | Saldo contratual de KM',14,201);doc.text(i+' / '+count,283,201,{align:'right'})}
    return new Uint8Array(doc.output('arraybuffer'));
  }
  function download(bytes,type,name){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function mount(){
    const get=id=>document.getElementById(id),body=get('budget-rows');
    const rows=()=>[...body.rows].filter(row=>row.cells.length===6).map(row=>[...row.cells].map(cell=>cell.innerText.trim()));
    const allowed=()=>!get('dashboard').hidden&&rows().length>0;
    const update=()=>{for(const kind of ['pdf','excel'])get('budget-'+kind).disabled=!allowed()};
    new MutationObserver(update).observe(body,{childList:true,subtree:true});
    new MutationObserver(update).observe(get('dashboard'),{attributes:true,attributeFilter:['hidden']});update();
    for(const kind of ['pdf','excel'])get('budget-'+kind).onclick=async()=>{
      if(!allowed())return;const button=get('budget-'+kind);button.disabled=true;
      try{
        const selected=rows(),filter='Base: '+(get('budget-base').value||'Todas')+' | Busca: '+(get('budget-search').value.trim()||'Todas as viaturas');
        if(kind==='excel'){
          const numeric=selected.map(row=>row.map((v,i)=>i>=2&&i<=4&&/^-?[\d.]+ km$/.test(v)?Number(v.replaceAll('.','').replace(' km','')):v));
          download(createWorkbook('KM disponível',headers,numeric),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','DER-KM-disponivel.xlsx');
        }else{
          const response=await fetch('logo-der.jpg');if(!response.ok)throw Error('Não foi possível carregar o logo DER.');
          download(pdf(selected,filter,new Uint8Array(await response.arrayBuffer())),'application/pdf','DER-KM-disponivel.pdf');
        }
      }catch(error){alert('Não foi possível gerar o arquivo: '+error.message)}finally{update()}
    };
  }
  return {pdf,mount};
})();
if(typeof document!=='undefined')ChecklistPanelExport.mount();
