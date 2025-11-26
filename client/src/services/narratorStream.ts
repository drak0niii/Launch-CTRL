// client/src/services/narratorStream.ts

export function subscribeToNarration(onMessage: (msg: string) => void) {
  const url = "http://localhost:8787/api/narrator/stream";
  const es = new EventSource(url);

  es.addEventListener("narration", (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data);
      if (data?.msg) onMessage(data.msg);
    } catch {}
  });

  es.onerror = () => {
    console.warn("[NarratorStream] connection lost, retrying soon...");
  };

  return () => es.close();
}
