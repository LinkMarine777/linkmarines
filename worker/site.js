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

export default {
  async fetch(req, env) {
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
