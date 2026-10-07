import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

/**
 * A loopback relay to the app server that a test can take down, so "offline"
 * is a real network failure on every engine.
 *
 * Playwright's WebKit applies `context.setOffline(true)` before a service
 * worker sees the request: measured on this build, a page the worker controls
 * gets "Load failed" for `fetch("./icon.svg")` and "WebKit encountered an
 * internal error" for a reload, both precached, while the same worker serves
 * them once the server itself stops answering. Requests through this relay
 * reach the worker normally, and after `goOffline()` every open connection is
 * dropped and each new request's socket is destroyed before any response, a
 * network error to the worker just as a lost network is.
 *
 * The relay is a different origin from `baseURL` (another port), so it gets
 * its own service-worker registration and Cache Storage.
 */
export type InterruptibleOrigin = {
  /** The app's root on the relay (same path as the upstream base URL). */
  url: string;
  /** Drop every open connection and answer no further request. */
  goOffline: () => void;
  close: () => Promise<void>;
};

export async function startInterruptibleOrigin(baseURL: string): Promise<InterruptibleOrigin> {
  const upstream = new URL(baseURL);
  const client = upstream.protocol === "https:" ? https : http;
  let offline = false;

  const server = http.createServer((request, response) => {
    if (offline) {
      request.socket.destroy();
      return;
    }
    const forwarded = client.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: upstream.host },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    forwarded.on("error", () => request.socket.destroy());
    request.pipe(forwarded);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}${upstream.pathname}`,
    goOffline: () => {
      offline = true;
      server.closeAllConnections();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
