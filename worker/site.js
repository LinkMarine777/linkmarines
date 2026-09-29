// The site is static files. This only runs for /terminal/token pages (see run_worker_first in wrangler.jsonc): it points
// the link preview (og:image) at the token's own share card, and for link-preview crawlers (X, Discord, Telegram...)
// also puts the token's name in the title. Anything unexpected: the page is served exactly as it is.
const BOT = 'https://war-room-bot.linkmarine777.workers.dev';
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CRAWLER = /bot|crawler|spider|facebookexternalhit|embedly|preview|slack|telegram|whatsapp|discord|twitter|linkedin|skype|vkshare|pinterest|redditbot|applebot/i;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default {
  async fetch(req, env) {
    const res = await env.ASSETS.fetch(req);
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
