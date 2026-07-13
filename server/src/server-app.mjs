import { createServer } from "node:http";

export function createForartServer({ handleRequest, onError }) {
  const server = createServer(handleRequest);
  let startReject = null;

  server.on("error", (error) => {
    if (startReject) {
      const reject = startReject;
      startReject = null;
      reject(error);
      return;
    }
    onError?.(error);
  });

  function start({ port, host }) {
    if (server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      startReject = reject;
      server.once("listening", () => {
        startReject = null;
        resolve();
      });
      server.listen(port, host);
    });
  }

  function close() {
    if (!server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  return {
    address: () => server.address(),
    close,
    start,
  };
}
