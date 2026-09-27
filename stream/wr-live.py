#!/usr/bin/env python3
"""War Room real-time trades (runs on the stream VPS, next to the stream).

Watches the $MARINE/LINK pool and the two main Solana LINK pools through a Helius websocket (logsSubscribe, one
subscription per pool), looks up each new transaction once (getTransaction), and pushes the swap to the stream
page within a second or two over a websocket that only listens on 127.0.0.1:8787. Website visitors are unaffected
(they keep the GeckoTerminal feed); only the stream page (?obs) connects here.

Cost: the websocket is free; one getTransaction per trade (about 3k a day across the three pools).
Load: one Python process, asleep between events. The Helius key stays in /etc/wr-live.env on this server.
"""
import asyncio, json, os, re, time, urllib.request

import websockets

ENV = '/etc/wr-live.env'
MARINE = 'F8Sc8HoZvJcMrTY6vBsetTqGPv6XQmM2XgVAZo1sSTNK'
LINK = 'LinkhB3afbBKb2EQQu7s7umdZceV3wcvAUJhQAfQ23L'
POOLS = {  # pool -> (feed, the token whose buys/sells this feed shows)
    'BnkYfw796XXq9UQ9kMYoX9iqSgXnjw7sFCsCVWVDiCUa': ('marine', MARINE),   # MARINE/LINK (Raydium)
    '7YRKyGCHBJYAE2uyAGRDiz5WNq68FPzh2uDvDaYv1cNE': ('link', LINK),       # LINK/USDC (Raydium)
    'C4Nnrur8ZDVsdX4Y3vwaCFJXCHWRrS9LdRxV7wuU6Xrr': ('link', LINK),       # LINK/SOL (Orca)
}


# who owns each pool's token vaults: Orca and Raydium CLMM pools own their own, Raydium CPMM pools share one authority
VAULT_OWNER = {p: p for p in POOLS} | {'BnkYfw796XXq9UQ9kMYoX9iqSgXnjw7sFCsCVWVDiCUa': 'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL'}
NOT_TRADERS = set(VAULT_OWNER.values()) | {'5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'}  # + Raydium AMM v4 authority


def load_env():
    out = {}
    if os.path.exists(ENV):
        for line in open(ENV):
            m = re.match(r'\s*([A-Z_]+)=(.*)', line)
            if m: out[m[1]] = m[2].strip().strip('"')
    return out


KEY = load_env().get('HELIUS_KEY', '')
RPC = f'https://mainnet.helius-rpc.com/?api-key={KEY}'
WSS = f'wss://mainnet.helius-rpc.com/?api-key={KEY}'
clients, seen, prices = set(), {}, {'at': 0}


def log(*a): print(*[str(x).replace(KEY, '***') for x in a], flush=True)


def post(url, body=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body else None, {'Content-Type': 'application/json', 'User-Agent': 'war-room-live'})
    with urllib.request.urlopen(req, timeout=20) as r: return json.load(r)


def refresh_prices():
    """USD prices from Jupiter's free price API, at most once a minute."""
    if time.time() - prices['at'] < 60: return
    try:
        d = post(f'https://lite-api.jup.ag/price/v3?ids={MARINE},{LINK}').get
        prices.update({MARINE: float(d(MARINE, {}).get('usdPrice') or 0) or prices.get(MARINE, 0),
                       LINK: float(d(LINK, {}).get('usdPrice') or 0) or prices.get(LINK, 0), 'at': time.time()})
    except Exception as e:
        log('prices', e)


def parse(sig, pool):
    """A swap in GeckoTerminal's trade shape (what the page already reads), from the pool vault's token balance change."""
    feed, mint = POOLS[pool]
    tx = post(RPC, {'jsonrpc': '2.0', 'id': 1, 'method': 'getTransaction',
                    'params': [sig, {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 0, 'commitment': 'confirmed'}]}).get('result')
    if not tx or (tx.get('meta') or {}).get('err'): return None
    # direction and size come from the pool's own vault (the pool losing the token = a buy). Routed trades are often
    # signed by a relayer and pass through several pools, so the signer's balance alone isn't reliable.
    d = {}
    for side, sgn in (('preTokenBalances', -1), ('postTokenBalances', 1)):
        for b in tx['meta'].get(side) or []:
            o = b.get('owner')
            if b.get('mint') == mint and o:
                d[o] = d.get(o, 0) + sgn * float((b.get('uiTokenAmount') or {}).get('uiAmountString') or 0)
    pool_delta = d.get(VAULT_OWNER[pool], 0)
    if abs(pool_delta) < 1e-9: return None
    buy, amt = pool_delta < 0, abs(pool_delta)
    # the trader: the wallet that received (buy) or gave up (sell) the most of the token, else the signer
    cands = [(v if buy else -v, o) for o, v in d.items() if o not in NOT_TRADERS and (v > 0) == buy and abs(v) > 1e-9]
    signer = max(cands)[1] if cands else tx['transaction']['message']['accountKeys'][0]['pubkey']
    refresh_prices()
    price = prices.get(mint) or 0
    t = {'tx_hash': sig, 'tx_from_address': signer, 'block_timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(tx.get('blockTime') or time.time())),
         'volume_in_usd': f'{amt * price:.2f}', 'realtime': True}
    if buy: t.update({'to_token_address': mint, 'to_token_amount': str(amt), 'price_to_in_usd': str(price), 'from_token_address': ''})
    else: t.update({'from_token_address': mint, 'from_token_amount': str(amt), 'price_from_in_usd': str(price), 'to_token_address': ''})
    return {'feed': feed, 'trade': t}


async def broadcast(msg):
    data = json.dumps(msg)
    for c in list(clients):
        try: await c.send(data)
        except Exception: clients.discard(c)


async def page_server(ws):
    clients.add(ws)
    try: await ws.wait_closed()
    finally: clients.discard(ws)


async def helius():
    subs = {}
    while True:
        try:
            async with websockets.connect(WSS, ping_interval=30, max_size=2 ** 22) as ws:
                for i, pool in enumerate(POOLS):
                    await ws.send(json.dumps({'jsonrpc': '2.0', 'id': i + 1, 'method': 'logsSubscribe',
                                              'params': [{'mentions': [pool]}, {'commitment': 'confirmed'}]}))
                ids = list(POOLS)
                log('helius connected, watching', len(POOLS), 'pools')
                async for raw in ws:
                    m = json.loads(raw)
                    if 'id' in m and 'result' in m: subs[m['result']] = ids[m['id'] - 1]; continue
                    p = (m.get('params') or {})
                    v = ((p.get('result') or {}).get('value') or {})
                    pool, sig = subs.get(p.get('subscription')), v.get('signature')
                    if not pool or not sig or v.get('err') or sig in seen: continue
                    seen[sig] = time.time()
                    if len(seen) > 5000:
                        for k in sorted(seen, key=seen.get)[:2500]: del seen[k]
                    try:
                        ev = await asyncio.to_thread(parse, sig, pool)
                        if ev: await broadcast(ev)
                    except Exception as e:
                        log('tx', sig[:8], e)
        except Exception as e:
            log('helius reconnecting:', e)
            await asyncio.sleep(5)


async def main():
    if not KEY:
        log(f'set HELIUS_KEY in {ENV}'); await asyncio.sleep(300); return
    async with websockets.serve(page_server, '127.0.0.1', 8787):
        await helius()


if __name__ == '__main__':
    asyncio.run(main())
