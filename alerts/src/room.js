// One room per streamer: their open browser sources (OBS overlays) stay connected here, and a new alert, a test or a
// skip reaches them at once. The alerts themselves live in D1; this only tells the overlays to look.
import { DurableObject } from 'cloudflare:workers';

export class Room extends DurableObject {
  async fetch(req) {
    if (req.headers.get('upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);   // hibernates while idle, so an overlay left open all stream costs ~nothing
      return new Response(null, { status: 101, webSocket: client });
    }
    const msg = await req.text();
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch (e) {} }
    return Response.json({ sent: this.ctx.getWebSockets().length });
  }
  webSocketMessage(ws, m) { if (m === 'ping') ws.send('pong'); }
  webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch (e) {} }
}
