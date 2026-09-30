// The site is static files. For /terminal/token pages this points
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
const TERMINAL = /^\/(trending|terminal|terminal2|terminal1\.1|flywheel)(\/|\.html|$)/;
function domains(req) {
  const u = new URL(req.url), host = u.hostname.replace(/^www\./, '');
  if (u.hostname === 'www.' + HQ || u.hostname === 'www.' + T7) return Response.redirect(`https://${host}${u.pathname}${u.search}`, 301);   // www -> the bare domain
  if (host === HQ && TERMINAL.test(u.pathname)) return Response.redirect(`https://${T7}${u.pathname}${u.search}`, 302);
  if (host === T7 && (u.pathname === '/' || u.pathname === '/index.html')) {
    // typed in / shared: the terminal (trending); clicked from inside the terminal (its HQ links): HQ
    let from = ''; try { from = new URL(req.headers.get('referer') || '').hostname.replace(/^www\./, ''); } catch (e) {}
    return Response.redirect(from === T7 ? `https://${HQ}/` : `https://${u.hostname}/trending/${u.search}`, 302);
  }
  return null;
}

export default {
  async fetch(req, env) {
    try { const r = domains(req); if (r) return r; } catch (e) {}
    const res = await env.ASSETS.fetch(req);
    if (!new URL(req.url).pathname.startsWith('/terminal/token')) return res;
    try {
      const ca = new URL(req.url).searchParams.get('ca');
      if (!MINT.test(ca || '') || !(res.headers.get('content-type') || '').includes('text/html')) return res;
      const img = `${BOT}/card/${ca}.png`;
      let title = null, desc = null;
      if (CRAWLER.test(req.headers.get('user-agent') || '')) {
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
      if (title) rw = rw.on('meta[property="og:title"]', set(esc(title).replace(/&amp;/g, '&'))).on('meta[property="og:description"]', set(desc)).on('meta[name="description"]', set(desc));
      return rw.transform(res);
    } catch (e) { return res; }
  },
};
