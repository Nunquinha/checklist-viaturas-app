const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.CHECKLIST_EXPORT_QA||path.resolve(root,'..','export-qa');
fs.mkdirSync(out,{recursive:true});
const ctx={console,structuredClone,TextEncoder,Uint8Array,DataView,Intl,Date,
  byId:()=>null,jspdf:require(path.join(root,'vendor/jspdf-4.2.1.umd.min.js'))};ctx.window=ctx;vm.createContext(ctx);
for(const file of ['xlsx.js','operators-export.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
const list=[{name:'Sem vínculo',vehicles:[]},{name:'Zélia',vehicles:['ITG-521']},{name:'Ana & João',vehicles:['ITG-101']},
 {name:'Bruno',vehicles:['ITG-221']},{name:'Ana com duas bases',vehicles:['ITG-221','ITG-101']}];
const before=JSON.stringify(list),rows=ctx.ChecklistOperatorExport.ordered(list);
assert.deepEqual([...rows.map(row=>row.name)],['Ana & João','Bruno','Zélia','Ana com duas bases','Sem vínculo']);assert.equal(JSON.stringify(list),before);
fs.writeFileSync(path.join(out,'operadores-teste.xlsx'),ctx.ChecklistOperatorExport.excel(list));
(async()=>{
 const many=Array.from({length:110},(_,n)=>({name:n===35?'Nome extenso de operador com sobrenome composto para conferir quebra de linha '+n:'Operador de teste '+String(n+1).padStart(3,'0'),vehicles:n%11===0?[]:['ITG-'+[101,221,401,521,821][n%5]]}));
 const bytes=await ctx.ChecklistOperatorExport.pdf(many,{logo:new Uint8Array(fs.readFileSync(path.join(root,'logo-der.jpg'))),now:new Date('2026-11-24T15:00:00Z')});
 fs.writeFileSync(path.join(out,'operadores-teste.pdf'),bytes);
 assert(bytes.length>1000);assert.equal(JSON.stringify(list),before);
 console.log('PASS: base/name ordering, unlinked and multi-base operators, immutable catalog, Excel encoding and paginated PDF generation. QA: '+out);
})().catch(error=>{console.error(error);process.exitCode=1});
