import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A tiny fake Ollama server bound to 127.0.0.1 on a random port, for tests.
 * Tests never contact a real Ollama instance.
 */
export interface MockOllama {
  url: string;
  requests: Array<{ path: string; body: unknown }>;
  /** Set what /api/chat answers with: a JS value is JSON-encoded into message.content; a string is sent raw. */
  reply: (content: unknown) => void;
  setStatus: (status: number) => void;
  setDelay: (ms: number) => void;
  close: () => Promise<void>;
}

const readJson = (req: IncomingMessage) =>
  new Promise<unknown>((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || 'null'));
      } catch {
        resolve(data);
      }
    });
  });

export async function startMockOllama(): Promise<MockOllama> {
  let content: unknown = { substitutions: [{ substitute: 'lemon juice', amount: '1 tbsp', note: 'Brighter flavor.' }] };
  let status = 200;
  let delay = 0;
  const requests: MockOllama['requests'] = [];
  const server: Server = createServer(async (req, res) => {
    const body = await readJson(req);
    requests.push({ path: req.url ?? '', body });
    await new Promise((r) => setTimeout(r, delay));
    if (status !== 200) {
      res.writeHead(status).end('error');
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }, { name: 'mistral:latest' }] }));
      return;
    }
    if (req.url === '/api/chat') {
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      res.end(JSON.stringify({ model: 'llama3.1:8b', message: { role: 'assistant', content: text }, done: true }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    reply: (c) => (content = c),
    setStatus: (s) => (status = s),
    setDelay: (ms) => (delay = ms),
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
