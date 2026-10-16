const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch({args:['--proxy-server='+process.env.HTTPS_PROXY,'--ignore-certificate-errors','--allow-file-access-from-files']});
const p=await b.newPage({viewport:{width:1920,height:1080}});p.on('pageerror',e=>console.log('PE',e.message));
await p.goto('file://'+__dirname+'/stage.html');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(800);
const total=await p.evaluate(()=>TOTAL);const mode=process.argv[2]||'stills';
if(mode==='stills'){const ts=process.argv.slice(3).map(Number);for(const t of ts){await p.evaluate(t=>render(t),t);await p.screenshot({path:`still_${t}.jpg`,type:'jpeg',quality:85})}console.log('total',total)}
else{fs.rmSync('out',{recursive:true,force:true});fs.mkdirSync('out');const N=Math.round(total*30);const t0=Date.now();
  for(let f=0;f<N;f++){await p.evaluate(t=>render(t),f/30);await p.screenshot({path:`out/${String(f).padStart(5,'0')}.jpg`,type:'jpeg',quality:90});if(f%300===0)console.log(f,'/',N,((Date.now()-t0)/1000).toFixed(0)+'s')}console.log('done',N)}
await b.close();process.exit(0)})();
