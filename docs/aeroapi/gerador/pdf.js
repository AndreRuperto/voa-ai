const {chromium}=require('playwright');
(async()=>{const [,,inp,out]=process.argv;const b=await chromium.launch();const p=await b.newPage();
await p.goto('file://'+inp,{waitUntil:'load'});
await p.pdf({path:out,format:'A4',printBackground:true,displayHeaderFooter:true,
 headerTemplate:'<div></div>',
 footerTemplate:'<div style="font-size:7pt;color:#8a97ab;width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>FlightAware AeroAPI · Documentação RepoPrint</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
 margin:{top:'16mm',bottom:'18mm',left:'14mm',right:'14mm'}});
await b.close();})();
