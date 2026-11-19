const workbookEncoding = new TextEncoder();
const workbookNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const workbookRelationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xmlText = value => String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const crcTable = Uint32Array.from({length:256},(_,index)=>{
  let crc = index;
  for(let bit=0;bit<8;bit++) crc = (crc>>>1)^((crc&1)?0xedb88320:0);
  return crc;
});
function workbookCrc(bytes) {
  let crc = 0xffffffff;
  for(const byte of bytes) crc = (crc>>>8)^crcTable[(crc^byte)&255];
  return (crc^0xffffffff)>>>0;
}

// A workbook is a ZIP of XML parts. Store the parts uncompressed for offline browser compatibility.
function workbookZip(parts) {
  const headers = [], directory = [];
  let offset = 0, directorySize = 0;
  for(const [path,value] of Object.entries(parts)) {
    const name = workbookEncoding.encode(path), data = workbookEncoding.encode(value), crc = workbookCrc(data);
    const make = (size,fields) => {
      const bytes = new Uint8Array(size+name.length), view = new DataView(bytes.buffer);
      for(const [position,number,width] of fields) {
        if(width===2)view.setUint16(position,number,true); else view.setUint32(position,number,true);
      }
      bytes.set(name,size);
      return bytes;
    };
    const local = make(30,[[0,0x04034b50],[4,20,2],[12,33,2],[14,crc],[18,data.length],[22,data.length],[26,name.length,2]]);
    const central = make(46,[[0,0x02014b50],[4,20,2],[6,20,2],[14,33,2],[16,crc],[20,data.length],
      [24,data.length],[28,name.length,2],[42,offset]]);
    headers.push(local,data);
    directory.push(central);
    offset += local.length+data.length;
    directorySize += central.length;
  }
  const output = new Uint8Array(offset+directorySize+22);
  let cursor = 0;
  for(const bytes of [...headers,...directory]) {
    output.set(bytes,cursor);
    cursor += bytes.length;
  }
  const end = new DataView(output.buffer,cursor);
  end.setUint32(0,0x06054b50,true);
  end.setUint16(8,directory.length,true);
  end.setUint16(10,directory.length,true);
  end.setUint32(12,directorySize,true);
  end.setUint32(16,offset,true);
  return output;
}

function createWorkbook(title,headers,rows) {
  const lastColumn = String.fromCharCode(64+headers.length);
  const cells = [headers,...rows].map((row,index)=>{
    const number = index+1;
    const columns = row.map((value,column)=>{
      const name = String.fromCharCode(65+column)+number;
      if(Number.isFinite(value))return '<c r="'+name+'"><v>'+value+'</v></c>';
      return '<c r="'+name+'" t="inlineStr"'+(index===0?' s="1"':'')+'><is><t xml:space="preserve">'+
        xmlText(value)+'</t></is></c>';
    });
    return '<row r="'+number+'">'+columns.join('')+'</row>';
  }).join('');
  const widths = headers.map((label,index)=>'<col min="'+(index+1)+'" max="'+(index+1)+'" width="'+
    (/Observações|Diferenças|Atraso|Ausência/.test(label)?44:/Operador|recebeu|entregou|Engenheiro/.test(label)?26:21)+'" customWidth="1"/>').join('');
  const types = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const relations = 'http://schemas.openxmlformats.org/package/2006/relationships';
  return workbookZip({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="'+types+'sheet.main+xml"/>'+
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="'+types+'worksheet+xml"/>'+
      '<Override PartName="/xl/styles.xml" ContentType="'+types+'styles+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="'+relations+'"><Relationship Id="rId1" Type="'+workbookRelationship+
      '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="'+workbookNamespace+'" xmlns:r="'+workbookRelationship+'"><sheets><sheet name="'+
      xmlText(title)+'" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="'+relations+'"><Relationship Id="rId1" Type="'+workbookRelationship+
      '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="'+workbookRelationship+
      '/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':'<styleSheet xmlns="'+workbookNamespace+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'+
      '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>'+
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+
      '<fill><patternFill patternType="solid"><fgColor rgb="FF26382E"/><bgColor indexed="64"/></patternFill></fill></fills>'+
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/></cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml':'<worksheet xmlns="'+workbookNamespace+'"><sheetViews><sheetView workbookViewId="0">'+
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>'+
      widths+'</cols><sheetData>'+cells+'</sheetData><autoFilter ref="A1:'+lastColumn+(rows.length+1)+'"/></worksheet>'
  });
}
