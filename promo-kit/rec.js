// records one clip per scene from the live site: CDP screencast frames + timestamps -> clips/<name>/
const {chromium}=require('playwright');const fs=require('fs');
const SITE='https://terminal7.xyz',MAR='F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK',MASK='HuAXPyDWDaMYFKuwQHpqL1oPnj93zdzWmtvFGzCeCUa7',WAL='8V4kM8JEGa4godgzbvAksQUtMNJ9GyPCxKqS6vUFTf72';
const only=process.argv.slice(2);
const CUR=`addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='#tcur{position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transition:transform .6s cubic-bezier(.4,.1,.2,1);transform:translate(-40px,-40px)}#tcur.clk::after{content:"";position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:2px solid #4a7aff;animation:rp .5s ease-out}@keyframes rp{from{opacity:1;transform:scale(.3)}to{opacity:0;transform:scale(1.7)}}';document.head.appendChild(s);const u=document.createElement('div');u.id='tcur';u.innerHTML='<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9 19z" fill="#fff" stroke="#000" stroke-width="1.3"/></svg>';document.body.appendChild(u);const d=document.createElement('div');d.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;z-index:2147483647;pointer-events:none';document.body.appendChild(d);let i=0;setInterval(()=>{d.style.background=(i++%2)?'rgba(6,10,24,.01)':'rgba(6,10,24,.02)'},33)})`;
(async()=>{const b=await chromium.launch({args:['--proxy-server='+process.env.HTTPS_PROXY,'--ignore-certificate-errors']});
async function clip(name,opt,fn){if(only.length&&!only.includes(name))return;
  const ctx=await b.newContext({viewport:opt.vp,deviceScaleFactor:opt.dsf||1,isMobile:!!opt.mobile,hasTouch:!!opt.mobile,locale:'en-US'});
  await ctx.addInitScript(CUR);await ctx.addInitScript(c=>{try{localStorage.setItem('wrCandle',c)}catch(e){}},opt.candle||'0');
  const p=await ctx.newPage();const cdp=await ctx.newCDPSession(p);const dir='clips/'+name;fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
  const T=[];let rec=false;cdp.on('Page.screencastFrame',f=>{cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{});if(!rec)return;fs.writeFileSync(`${dir}/${String(T.length).padStart(5,'0')}.jpg`,Buffer.from(f.data,'base64'));T.push(f.metadata.timestamp)});
  const W=opt.vp.width*(opt.dsf||1),H=opt.vp.height*(opt.dsf||1);
  const h={p,wait:ms=>p.waitForTimeout(ms),
    start:async()=>{await cdp.send('Page.startScreencast',{format:'jpeg',quality:92,maxWidth:W,maxHeight:H});await p.waitForTimeout(150);rec=true},
    mv:async(sel,click=true)=>{let el=typeof sel==='string'?null:sel;if(typeof sel==='string'){for(const e of await p.$$(sel))if(await e.isVisible()){el=e;break}}if(!el)return console.log(name,'missing',sel);
      const bx=await el.boundingBox();const x=bx.x+bx.width/2,y=bx.y+bx.height/2;await p.evaluate(([x,y])=>{const u=document.getElementById('tcur');if(u)u.style.transform=`translate(${x}px,${y}px)`},[x,y]);await p.waitForTimeout(650);
      if(click){await p.evaluate(()=>{const u=document.getElementById('tcur');if(!u)return;u.classList.remove('clk');void u.offsetWidth;u.classList.add('clk')});await p.mouse.click(x,y)}else await p.mouse.move(x,y)},
    btn:async(scope,t)=>{const el=await p.$(`${scope} >> text="${t}"`);if(el)await h.mv(el);else console.log(name,'no btn',scope,t)},
    scroll:async(y,ms=1200,el)=>{await p.evaluate(([y,ms,el])=>new Promise(r=>{const n=el?document.querySelector(el):null,g=()=>n?n.scrollTop:scrollY,set=v=>n?n.scrollTop=v:scrollTo(0,v);const s=g(),t0=performance.now();const f=t=>{const k=Math.min(1,(t-t0)/ms),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;set(s+(y-s)*e);k<1?requestAnimationFrame(f):r()};requestAnimationFrame(f)}),[y,ms,el||null])}};
  await fn(h);rec=false;await cdp.send('Page.stopScreencast').catch(()=>{});fs.writeFileSync(`${dir}/times.json`,JSON.stringify(T));console.log(name,T.length,'frames',(T[T.length-1]-T[0]).toFixed(1)+'s');await ctx.close()}
const D={vp:{width:1280,height:800}},M={vp:{width:390,height:844},dsf:2,mobile:true};
// warm caches
{const ctx=await b.newContext({locale:'en-US'});const p=await ctx.newPage();for(const u of [SITE+'/trending/',SITE+'/terminal/token?ca='+MAR,SITE+'/terminal/token?ca='+MASK]){await p.goto(u);await p.waitForTimeout(4000)}await ctx.close()}
await clip('trend_top',D,async h=>{await h.p.goto(SITE+'/trending/');await h.wait(5500);await h.start();await h.wait(1500);await h.scroll(260,2500);await h.wait(1500)});
await clip('trend_whale',D,async h=>{await h.p.goto(SITE+'/trending/');await h.wait(5500);await h.p.evaluate(()=>scrollTo(0,230));await h.wait(800);await h.start();await h.wait(600);
  await h.btn('#wk','SELLING');await h.wait(1600);await h.btn('#wk','BUYING');await h.wait(1300);await h.btn('#fp','1H');await h.wait(1600);await h.btn('#fp','24H');await h.wait(1200)});
await clip('trend_alerts',D,async h=>{await h.p.goto(SITE+'/trending/');await h.wait(5500);await h.p.evaluate(()=>scrollTo(0,230));await h.wait(800);await h.start();await h.wait(500);
  for(const t of ['WHALES','PAYOUTS','COMPOUND','ALL']){await h.btn('#fk',t);await h.wait(1100)}});
await clip('trend_board',D,async h=>{await h.p.goto(SITE+'/trending/');await h.wait(5500);await h.p.evaluate(()=>scrollTo(0,700));await h.wait(800);await h.start();await h.wait(500);
  for(const t of ['APY','COMPOUND','VOLUME']){await h.btn('#sort',t);await h.wait(1400)}await h.scroll(1100,1800);await h.wait(800)});
await clip('m_trend',M,async h=>{await h.p.goto(SITE+'/trending/');await h.wait(6000);await h.start();await h.wait(1200);await h.scroll(700,2600);await h.wait(1200);await h.scroll(1500,2600);await h.wait(1000)});
await clip('chart',D,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR);await h.wait(6000);await h.start();await h.wait(700);
  const cb=await (await h.p.$('#chart')).boundingBox();for(const fx of [.3,.5,.68,.86]){const x=cb.x+cb.width*fx,y=cb.y+cb.height*.45;await h.p.evaluate(([x,y])=>{document.getElementById('tcur').style.transform=`translate(${x}px,${y}px)`},[x,y]);await h.wait(450);await h.p.mouse.move(x,y);await h.wait(650)}
  await h.p.mouse.move(5,5);await h.mv('#candleBtn');await h.wait(1500)});
await clip('swap',D,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR);await h.wait(6000);await h.start();await h.wait(800);await h.mv('button[data-v="swap"]');await h.wait(3500);
  const inp=h.p.locator('#jupSwap input').first();try{const bx=await inp.boundingBox({timeout:3000});await h.p.evaluate(([x,y])=>{document.getElementById('tcur').style.transform=`translate(${x}px,${y}px)`},[bx.x+bx.width*.7,bx.y+bx.height/2]);await h.wait(700);await inp.click();await h.p.keyboard.type('5',{delay:200});}catch(e){console.log('swap input',e.message.slice(0,80))}
  await h.wait(3500)});
await clip('board',D,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR);await h.wait(6000);await h.p.evaluate(()=>scrollTo(0,120));await h.start();await h.mv('#sbLink',false);await h.wait(3500)});
await clip('holders2',D,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR);await h.wait(6000);await h.p.evaluate(()=>{const e=document.getElementById('holdTab');scrollTo(0,e.getBoundingClientRect().top+scrollY-90)});await h.wait(600);await h.start();await h.wait(600);await h.mv('#holdTab');await h.wait(2800);await h.mv('a.walA',false);await h.wait(2200)});
await clip('m_wallet',M,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR+'&w='+WAL);await h.wait(9000);await h.start();await h.wait(1500);
  const sc=await h.p.evaluate(()=>{const m=document.getElementById('walModal');const c=[m,...m.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+20&&getComputedStyle(e).overflowY!=='visible');if(c){c.id=c.id||'walScroll';return '#'+c.id}return null});
  console.log('scroller',sc);await h.scroll(650,2600,sc);await h.wait(1200);const row=await h.p.$('tr.wcr');if(row){await row.scrollIntoViewIfNeeded();await h.mv(row);await h.wait(2200)}await h.scroll(99999,3000,sc);await h.wait(2000)});
await clip('wallet',D,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR+'&w='+WAL);await h.wait(9000);await h.start();await h.wait(2000);const row=await h.p.$('tr.wcr');if(row){await h.mv(row);await h.wait(2500)}await h.wait(800)});
await clip('m_token',M,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR);await h.wait(7000);await h.start();await h.wait(1500);await h.scroll(500,2200);await h.wait(1200);await h.scroll(1100,2200);await h.wait(1200)});
await clip('clobr',D,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MASK);await h.wait(6500);await h.start();await h.wait(500);await h.mv('#depthBtn',false);await h.wait(2500);await h.scroll(1000,2200);await h.wait(2200)});
await clip('m_swap',M,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR);await h.wait(7000);await h.start();await h.wait(1200);
  await h.mv('#mbar .buyTk');await h.wait(3500);
  const inp=h.p.locator('#jupSwap input').first();try{const bx=await inp.boundingBox({timeout:3000});await h.p.evaluate(([x,y])=>{document.getElementById('tcur').style.transform=`translate(${x}px,${y}px)`},[bx.x+bx.width*.7,bx.y+bx.height/2]);await h.wait(700);await inp.click();await h.p.keyboard.type('5',{delay:200});}catch(e){console.log('m swap input',e.message.slice(0,80))}
  await h.wait(3500)});
const typeIn=async(h,sel,txt)=>{const el=h.p.locator(sel+" >> visible=true").first();const bx=await el.boundingBox();await h.p.evaluate(([x,y])=>{const u=document.getElementById('tcur');if(u)u.style.transform=`translate(${x}px,${y}px)`},[bx.x+40,bx.y+bx.height/2]);await h.wait(600);await el.click();await h.p.keyboard.type(txt,{delay:45})};
await clip('tts',D,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR);await h.wait(6000);await h.start();await h.wait(600);await h.mv('button:has-text("BUY TTS")');await h.wait(1400);
  await typeIn(h,'input[placeholder="@you"]','@marine_maxi');await h.wait(300);await typeIn(h,'textarea','LFG Marines! Just compounded all my LINK back into MARINE');await h.wait(2200)});
await clip('ads',D,async h=>{await h.p.goto(SITE+'/terminal/token?ca='+MAR);await h.wait(6000);await h.start();await h.wait(600);await h.mv('button:has-text("BUY TTS")');await h.wait(1200);
  await h.mv('button:has-text("BILLBOARD")');await h.wait(900);await typeIn(h,'input[placeholder^="BIG TEXT"]','HOLD $MARINE. GET PAID IN LINK.');await h.wait(300);await typeIn(h,'input[placeholder^="smaller"]','the home of Marines · terminal7.xyz');await h.wait(1400);
  await h.mv('button:has-text("IMAGE AD")');await h.wait(2200)});
await clip('stream',{vp:{width:1920,height:1080}},async h=>{await h.p.goto(SITE+'/stream/');await h.wait(9000);await h.start();await h.wait(9000)});
await b.close();process.exit(0)})();
