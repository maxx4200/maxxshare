import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import Peer, { type DataConnection } from "peerjs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Camera,
  Square,
  Download,
  FileIcon,
  Loader2,
  Wifi,
  Check,
  Link2,
} from "lucide-react";
import { type ControlMessage, formatBytes, parsePeerCode, PEER_CONFIG } from "@/lib/peer-utils";

const REGION_ID = "qr-reader-region";

type Status =
  | "idle"
  | "scanning"
  | "connecting"
  | "receiving"
  | "done"
  | "error";

type ReceivedMeta = { name: string; size: number; mime: string };

export function QRReceiver() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const chunksRef = useRef<ArrayBuffer[]>([]);
  const pendingChunksRef = useRef<Promise<void>>(Promise.resolve());
  const receivedBytesRef = useRef(0);

  const [status, setStatus] = useState<Status>("idle");
  const statusRef = useRef<Status>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [meta, setMeta] = useState<ReceivedMeta | null>(null);
  const metaRef = useRef<ReceivedMeta | null>(null);
  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const triggerDownload = (url: string, fileName: string) => {
    if (!document.body) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const readBinaryChunk = async (data: unknown): Promise<ArrayBuffer | null> => {
    if (data instanceof ArrayBuffer) return data;
    if (data instanceof Blob) return data.arrayBuffer();
    if (ArrayBuffer.isView(data)) {
      const copy = new Uint8Array(data.byteLength);
      copy.set(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
      return copy.buffer;
    }
    return null;
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch {
        /* ignore */
      }
      scannerRef.current = null;
    }
  };

  const cleanupPeer = () => {
    try {
      connRef.current?.close();
    } catch {
      /* noop */
    }
    try {
      peerRef.current?.destroy();
    } catch {
      /* noop */
    }
    connRef.current = null;
    peerRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopScanner();
      cleanupPeer();
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectToPeer = (rawCode: string) => {
    const id = parsePeerCode(rawCode);
    if (!id) {
      setError("Empty code");
      setStatus("error");
      return;
    }

    setError(null);
    setStatus("connecting");
    setProgress(0);
    setMeta(null);
    metaRef.current = null;
    chunksRef.current = [];
    pendingChunksRef.current = Promise.resolve();
    receivedBytesRef.current = 0;
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }

    cleanupPeer();
    const peer = new Peer(PEER_CONFIG);
    peerRef.current = peer;

    // 15s safety timeout — if the data channel never opens, surface a clear error
    const timeout = setTimeout(() => {
      if (statusRef.current === "connecting") {
        setError(
          "Couldn't reach the sender. Check both phones are online and the sender still has the file selected.",
        );
        setStatus("error");
        cleanupPeer();
      }
    }, 15000);

    peer.on("open", () => {
      const conn = peer.connect(id, { reliable: true });
      connRef.current = conn;

      conn.on("open", () => {
        clearTimeout(timeout);
        setStatus("receiving");
      });

      conn.on("data", (data) => {
        if (
          data instanceof ArrayBuffer ||
          data instanceof Blob ||
          ArrayBuffer.isView(data)
        ) {
          pendingChunksRef.current = pendingChunksRef.current.then(async () => {
            const chunk = await readBinaryChunk(data);
            if (!chunk) return;
            chunksRef.current.push(chunk);
            receivedBytesRef.current += chunk.byteLength;
            const currentMeta = metaRef.current;
            if (currentMeta && currentMeta.size > 0) {
              setProgress(
                Math.min(
                  99,
                  Math.round((receivedBytesRef.current / currentMeta.size) * 100),
                ),
              );
            }
          });
          return;
        }
        const msg = data as ControlMessage;
        if (msg && msg.type === "meta") {
          const nextMeta = { name: msg.name, size: msg.size, mime: msg.mime };
          metaRef.current = nextMeta;
          setMeta(nextMeta);
        } else if (msg && msg.type === "done") {
          // Assemble the file
          pendingChunksRef.current.then(() => {
            const m = metaRef.current;
            const mime = m?.mime || "application/octet-stream";
            const name = m?.name || "beamshare-file";
            const blob = new Blob(chunksRef.current, { type: mime });
            const url = URL.createObjectURL(blob);
            setDownloadUrl(url);
            setStatus("done");
            setProgress(100);
            setTimeout(() => triggerDownload(url, name), 250);
          });
        }
      });

      conn.on("error", (err) => {
        clearTimeout(timeout);
        setError(err.message || "Connection error");
        setStatus("error");
      });
    });

    peer.on("error", (err) => {
      clearTimeout(timeout);
      const m = err.message || "Could not connect";
      // Friendlier message for the most common case
      if (m.includes("could not be found") || m.includes("peer-unavailable")) {
        setError("Sender not found. Make sure they have a file selected.");
      } else {
        setError(m);
      }
      setStatus("error");
    });
  };

  const startScanning = async () => {
    setError(null);
    try {
      if (!window.isSecureContext) {
        throw new Error("Camera works only on HTTPS. Open the live app link in Chrome, not an insecure page.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not allow camera access here. Open the app in Chrome and allow Camera permission.");
      }
      setStatus("scanning");
      const instance = new Html5Qrcode(REGION_ID, { verbose: false });
      scannerRef.current = instance;
      await instance.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded) => {
          await stopScanner();
          connectToPeer(decoded);
        },
        () => {
          /* ignore per-frame errors */
        },
      );
    } catch (e) {
      try {
        await scannerRef.current?.clear();
      } catch {
        /* ignore */
      }
      setError(
        e instanceof Error
          ? e.message
          : "Camera unavailable. Allow camera access and try again.",
      );
      setStatus("error");
      scannerRef.current = null;
    }
  };

  const stopScanning = async () => {
    await stopScanner();
    setStatus("idle");
  };

  const reset = async () => {
    await stopScanner();
    cleanupPeer();
    chunksRef.current = [];
    pendingChunksRef.current = Promise.resolve();
    receivedBytesRef.current = 0;
    setMeta(null);
    metaRef.current = null;
    setProgress(0);
    setError(null);
    setStatus("idle");
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
  };

  const showCamera =
    status === "idle" || status === "scanning" || status === "error";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const peer = params.get("peer");
    if (peer) connectToPeer(peer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-6 bg-card/60 backdrop-blur border-border/60 max-w-md mx-auto">
      <div className="space-y-4">
        {showCamera && (
          <>
            <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-background/60 border border-border/60">
              <div id={REGION_ID} className="h-full w-full" />
              {status !== "scanning" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-muted-foreground p-8">
                  <div
                    className="mx-auto size-16 rounded-2xl flex items-center justify-center mb-3"
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    <Camera className="size-8 text-primary-foreground" />
                  </div>
                  <p className="text-sm">Tap start to open your camera</p>
                </div>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <div className="flex gap-2 justify-center">
              {status !== "scanning" ? (
                <Button onClick={startScanning} className="flex-1">
                  <Camera className="size-4 mr-2" /> Scan pairing code
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={stopScanning}
                  className="flex-1"
                >
                  <Square className="size-4 mr-2" /> Stop
                </Button>
              )}
            </div>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-border/60" />
              <span className="mx-3 text-xs text-muted-foreground">
                or enter code
              </span>
              <div className="flex-grow border-t border-border/60" />
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="beam-xxxx-1234"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="font-mono"
              />
              <Button
                onClick={() => connectToPeer(manualCode)}
                disabled={!manualCode.trim()}
              >
                <Link2 className="size-4 mr-2" /> Connect
              </Button>
            </div>
          </>
        )}

        {(status === "connecting" ||
          status === "receiving" ||
          status === "done") && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-background/40 p-4 flex items-center gap-3">
              <div
                className="size-12 shrink-0 rounded-xl flex items-center justify-center"
                style={{ background: "var(--gradient-primary)" }}
              >
                {status === "done" ? (
                  <Check className="size-6 text-primary-foreground" />
                ) : (
                  <FileIcon className="size-6 text-primary-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {meta ? (
                  <>
                    <p className="text-sm font-medium break-all">
                      {meta.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(meta.size)} · {meta.mime}
                    </p>
                  </>
                ) : (
                  <p className="text-sm font-medium">Connecting…</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  {status === "connecting" && (
                    <>
                      <Loader2 className="size-3 animate-spin" /> Pairing…
                    </>
                  )}
                  {status === "receiving" && (
                    <>
                      <Wifi className="size-3" /> Receiving…
                    </>
                  )}
                  {status === "done" && (
                    <>
                      <Check className="size-3" /> Complete
                    </>
                  )}
                </span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>

            {status === "done" && downloadUrl && meta && (
              <Button asChild className="w-full">
                <a href={downloadUrl} download={meta.name}>
                  <Download className="size-4 mr-2" /> Save file
                </a>
              </Button>
            )}

            <Button variant="outline" onClick={reset} className="w-full">
              {status === "done" ? "Receive another" : "Cancel"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
