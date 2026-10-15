// The site is static files. For /terminal/token pages (and a wallet's page, /wallet/<address>) this points
// the link preview (og:image) at the token's own share card, and for link-preview crawlers (X, Discord, Telegram...)
// also puts the token's name in the title. Anything unexpected: the page is served exactly as it is.
const BOT = 'https://war-room-bot.linkmarine777.workers.dev';
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CRAWLER = /bot|crawler|spider|facebookexternalhit|embedly|preview|slack|telegram|whatsapp|discord|twitter|linkedin|skype|vkshare|pinterest|redditbot|applebot/i;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Two domains, one site: themarines.link is HQ (the homepage, bridge, memes...), terminal7.xyz is the terminal. Terminal pages
// opened on themarines.link go to terminal7.xyz; the terminal's HQ links (href="/") go to themarines.link. The stream is served
// on both as is (nothing pointing at it may break). Every other host (workers.dev, previews) is served unchanged.
const HQ = 'themarines.link', T7 = 'terminal7.xyz';
const TERMINAL = /^\/(trending|launches|terminal|terminal2|terminal1\.1|flywheel|wallet)(\/|\.html|$)/;
function domains(req) {
  const u = new URL(req.url), host = u.hostname.replace(/^www\./, '');
  if (u.hostname === 'www.' + HQ || u.hostname === 'www.' + T7) return Response.redirect(`https://${host}${u.pathname}${u.search}`, 301);   // www -> the bare domain
  if (host === HQ && TERMINAL.test(u.pathname)) return Response.redirect(`https://${T7}${u.pathname}${u.search}`, 302);
  if (host === T7 && (u.pathname === '/' || u.pathname === '/index.html')) {
    // typed in / shared: the terminal (trending); clicked from inside the terminal (its HQ links): HQ
    let from = ''; try { from = new URL(req.headers.get('referer') || '').hostname.replace(/^www\./, ''); } catch (e) {}
    return Response.redirect(from === T7 ? `https://${HQ}/` : `https://${u.hostname}/trending/${u.search}`, 302);
  }
  // the old /terminal/ and /terminal2/ addresses: a real redirect (the pages only moved in the browser, so link previews of
  // old shared links came out blank): a token link to its token page, anything else to the stream / trending
  const old = /^\/(terminal2?)\/?(index\.html)?$/.exec(u.pathname);
  if (old) return Response.redirect(`https://${u.hostname}${u.searchParams.get('ca') ? '/terminal/token' : old[1] === 'terminal' ? '/stream/' : '/trending/'}${u.search}`, 301);
  // pages that only moved in the browser (a script): a real redirect, so a shared link's preview isn't blank
  const moved = { '/tts': '/tts/checkout', '/terminal2/token': '/terminal/token', '/terminal2/trending': '/trending/', '/terminal2/checkout': '/tts/checkout' }[u.pathname.replace(/(\/index)?(\.html)?\/?$/, '')];
  if (moved) return Response.redirect(`https://${u.hostname}${moved}${u.search || (moved === '/tts/checkout' ? '?k=t' : '')}`, 301);
  return null;
}

// Wallet relay (/wr/): Phantom and Solflare answer a connect or signing request by opening a link. On an iPhone that link
// opens in Safari, never in the home-screen app, so it points here: /wr/back keeps the answer (still encrypted for the app's
// own key: only the app can read it) for 10 minutes and tells the visitor to switch back; the app picks it up from /wr/get.
// Held in this data center's cache (Safari and the app on the same phone reach the same one), read once.
const WR_ID = /^[0-9a-f]{32}$/;
// /wr/open?to=<a wallet's universal link>: one button to it. From the home-screen app, a wallet's universal link opens in an
// in-app browser that won't hand it to the app; a tap on a link to another site from a page does. Only these wallets' links.
const WR_OPEN = { 'phantom.app': 'Phantom', 'phantom.com': 'Phantom', 'solflare.com': 'Solflare', 'backpack.app': 'Backpack' };
function walletOpen(u) {
  let to = null; try { to = new URL(u.searchParams.get('to') || ''); } catch (e) {}
  const name = to && to.protocol === 'https:' && /^\/ul\//.test(to.pathname) && WR_OPEN[to.hostname];
  if (!name) return new Response('not a wallet link', { status: 400 });
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open ${name}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#04060f;color:#c9d3ee;font:15px/1.5 ui-monospace,monospace;text-align:center;padding:24px;box-sizing:border-box}
a{display:block;margin:18px auto 10px;padding:16px 28px;border:2px solid #ffd23f;color:#ffd23f;text-decoration:none;font-size:18px;letter-spacing:.06em}small{color:#5d6a8f}</style>
<div>Tap to open ${name}<a href="${esc(to.href)}">OPEN ${name.toUpperCase()} ↗</a><small>Nothing happens? ${name} may not be installed on this phone.</small></div>`,
    { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
async function walletRelay(req, u) {
  const id = u.searchParams.get('s') || '', key = new Request(`https://${u.hostname}/__wr-cache/${id}`), cache = caches.default;
  if (!WR_ID.test(id)) return new Response('bad id', { status: 400 });
  if (u.pathname === '/wr/get') {
    const hit = await cache.match(key);
    if (!hit) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    await cache.delete(key);
    return new Response(await hit.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  const q = {}; for (const [k, v] of u.searchParams) if (k !== 's' && v.length < 6000) q[k] = v;
  await cache.put(key, new Response(JSON.stringify(q), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=600' } }));
  const ok = !q.errorCode, wallet = q.phantom_encryption_public_key ? 'Phantom' : q.solflare_encryption_public_key ? 'Solflare' : 'your wallet';
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Back to Terminal 7</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#04060f;color:#c9d3ee;font:15px/1.5 ui-monospace,monospace;text-align:center;padding:24px;box-sizing:border-box}
b{color:#ffd23f;font-size:20px;display:block;margin-bottom:10px}small{color:#5d6a8f;display:block;margin-top:14px}</style>
<div><b>${ok ? '✅ Done' : '✖ ' + esc(q.errorMessage || 'Cancelled')}</b>${ok ? `Approved in ${esc(wallet)}.` : ''}<br>Now switch back to the <b style="display:inline;font-size:inherit">Terminal 7</b> app to finish.<small>You can close this tab.</small></div>`,
    { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
}

export default {
  async fetch(req, env) {
    { const u = new URL(req.url); if (u.pathname === '/wr/open') return walletOpen(u); if (u.pathname === '/wr/back' || u.pathname === '/wr/get') return walletRelay(req, u); }
    // the streamer alerts service (alerts/, its own Worker): every /alerts request goes to it, on both domains
    if (env.ALERTS && /^\/alerts(\/|$)/.test(new URL(req.url).pathname)) return env.ALERTS.fetch(req);
    try { const r = domains(req); if (r) return r; } catch (e) {}
    // a token's share card, from the bot but on this domain (X won't show preview images hosted on workers.dev)
    // (and a wallet's: /card/wallet/<address>.png, the token page's wallet window)
    const card = /^\/card\/((?:wallet\/)?[1-9A-HJ-NP-Za-km-z]{32,44})\.png$/.exec(new URL(req.url).pathname);
    if (card) {
      try {
        const r = await (env.BOT ? env.BOT.fetch(`${BOT}/card/${card[1]}.png`) : fetch(`${BOT}/card/${card[1]}.png`));
        if (r.ok) return new Response(r.body, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' } });
      } catch (e) {}
      // the bot didn't answer: the generic Terminal 7 image from this site's own files (never a redirect to workers.dev, which X won't show)
      try { const g = await env.ASSETS.fetch(new Request(new URL('/share-terminal7-v3.png', req.url))); if (g.ok) return new Response(g.body, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=60' } }); } catch (e) {}
      return Response.redirect(`${BOT}/card/${card[1]}.png`, 302);
    }
    // /launches/: the trending page, which opens on its NEW LAUNCHES view (the two are one page with a switch)
    const lp = new URL(req.url).pathname;
    if (lp === '/launches') return Response.redirect(new URL('/launches/' + new URL(req.url).search, req.url).toString(), 301);
    if (lp === '/launches/' || lp === '/launches/index.html') return env.ASSETS.fetch(new Request(new URL('/trending/' + new URL(req.url).search, req.url), req));
    // a wallet's own page, /wallet/<address>: the Wallet X-Ray (terminal/wallet.html), with the wallet's card as its link preview
    const wpage = /^\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/.exec(new URL(req.url).pathname);
    const res = wpage ? await env.ASSETS.fetch(new Request(new URL('/terminal/wallet', req.url), req)) : await env.ASSETS.fetch(req);
    if (!wpage && !new URL(req.url).pathname.startsWith('/terminal/token')) return res;
    try {
      const ca = new URL(req.url).searchParams.get('ca');
      if ((!wpage && !MINT.test(ca || '')) || !(res.headers.get('content-type') || '').includes('text/html')) return res;
      const wal = wpage ? wpage[1] : new URL(req.url).searchParams.get('w');   // a shared wallet window: the wallet's card instead of the token's
      const img = MINT.test(wal || '') ? `${new URL(req.url).origin}/card/wallet/${wal}.png` : `${new URL(req.url).origin}/card/${ca}.png`;
      let title = null, desc = null;
      if (MINT.test(wal || '')) {
        // a known trader (who's who, the bot's /kol): their name in the title, like the X-Ray and the card
        const ask = env.BOT ? env.BOT.fetch(`${BOT}/kol?w=${wal}`) : fetch(`${BOT}/kol?w=${wal}`);
        const k = CRAWLER.test(req.headers.get('user-agent') || '') ? await Promise.race([ask, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000))]).then(r => r.json()).then(d => d && d[wal]).catch(() => null) : null;
        title = k ? `${k.name}${k.x ? ' (@' + k.x + ')' : ''} on Terminal 7` : `Wallet ${wal.slice(0, 4)}…${wal.slice(-4)} on Terminal 7`;
        desc = 'Compound score, rewards and stonkfun holdings for this wallet on Terminal 7.';
      } else if (CRAWLER.test(req.headers.get('user-agent') || '')) {
        const ask = env.BOT ? env.BOT.fetch(`${BOT}/token/${ca}`) : fetch(`${BOT}/token/${ca}`, { cf: { cacheTtl: 300 } });
        const t = await Promise.race([ask, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]).then(r => r.json()).catch(() => null);
        if (t && t.symbol) {
          const sym = String(t.symbol).replace(/^\$/, ''), q = t.quote?.symbol ? String(t.quote.symbol).replace(/^\$/, '') : null;
          title = `$${sym}${t.name ? ' · ' + t.name : ''} on Terminal 7`;
          desc = q ? `Hold $${sym}, get paid in $${q}. Live price, holders, payouts, whale moves and CLOBr depth on Terminal 7.` : `Live price, chart, holders and whale moves for $${sym} on Terminal 7.`;
        }
      }
      const set = v => ({ element(e) { e.setAttribute('content', v); } });
      let rw = new HTMLRewriter().on('meta[property="og:image"]', set(img)).on('meta[name="twitter:image"]', set(img));
      if (title) rw = rw.on('title', { element(e) { e.setInnerContent(title); } }).on('meta[property="og:title"]', set(esc(title).replace(/&amp;/g, '&'))).on('meta[property="og:description"]', set(desc)).on('meta[name="description"]', set(desc));
      return rw.transform(res);
    } catch (e) { return res; }
  },
};
