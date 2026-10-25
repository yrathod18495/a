// A small local S3 / R2 look-alike over real HTTP (PUT, GET, HEAD, DELETE by path; signatures are not checked), so tests can run the real
// browser code and the real API handlers against it.
import http from 'node:http';
export async function startFakeS3() {
  const objects = new Map(), log = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      log.push(`${req.method} ${key}`);
      if (req.method === 'PUT') { objects.set(key, Buffer.concat(chunks)); res.writeHead(200, { ETag: '"x"' }); return res.end(); }
      const body = objects.get(key);
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      if (!body) { res.writeHead(404, { 'Content-Type': 'application/xml' }); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
      res.writeHead(200, { 'Content-Length': body.length, 'Content-Type': 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, objects, log, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}
