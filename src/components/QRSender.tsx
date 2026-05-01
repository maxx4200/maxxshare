import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Peer, { type DataConnection } from "peerjs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  FileIcon,
  Trash2,
  Wifi,
  Check,
  Loader2,
  Copy,
} from "lucide-react";
import {
  CHUNK_SIZE,
  type ControlMessage,
  formatBytes,
  newPeerId,
  PEER_CONFIG,
} from "@/lib/peer-utils";

type Status = "idle" | "waiting" | "connected" | "sending" | "done" | "error";

export function QRSender() {
  const [file, setFile] = useState<File | null>(null);
  const [peerId, setPeerId] = useState<string>("");
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanup = () => {
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
    return () => cleanup();
  }, []);

  const startHosting = async (f: File) => {
    cleanup();
    setErrorMsg(null);
    setProgress(0);
    setStatus("waiting");

    const id = newPeerId();
    setPeerId(id);

    const peer = new Peer(id, PEER_CONFIG);
    peerRef.current = peer;

    peer.on("open", async () => {
      const pairingUrl = new URL(window.location.href);
      pairingUrl.searchParams.set("mode", "receive");
      pairingUrl.searchParams.set("peer", id);
      const url = await QRCode.toDataURL(pairingUrl.toString(), {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 512,
        color: { dark: "#0a1628", light: "#ffffff" },
      });
      setQr(url);
    });

    peer.on("error", (err) => {
      setErrorMsg(err.message || "Connection error");
      setStatus("error");
    });

    peer.on("connection", (conn) => {
      connRef.current = conn;
      setStatus("connected");

      conn.on("open", async () => {
        await sendFile(conn, f);
      });

      conn.on("error", (err) => {
        setErrorMsg(err.message || "Transfer error");
        setStatus("error");
      });

      conn.on("close", () => {
        if (status !== "done") {
          // Connection closed mid-flight only matters if we weren't done.
        }
      });
    });
  };

  const sendFile = async (conn: DataConnection, f: File) => {
    setStatus("sending");
    setProgress(0);

    const meta: ControlMessage = {
      type: "meta",
      name: f.name,
      size: f.size,
      mime: f.type || "application/octet-stream",
    };
    conn.send(meta);

    let offset = 0;
    while (offset < f.size) {
      const slice = f.slice(offset, offset + CHUNK_SIZE);
      const buf = await slice.arrayBuffer();
      // Backpressure: wait if the data channel buffer is too full.
      // peerjs exposes the underlying RTCDataChannel via .dataChannel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dc: RTCDataChannel | undefined = (conn as any).dataChannel;
      if (dc) {
        while (dc.bufferedAmount > 8 * 1024 * 1024) {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      conn.send(buf);
      offset += buf.byteLength;
      setProgress(Math.round((offset / f.size) * 100));
    }

    const done: ControlMessage = { type: "done" };
    conn.send(done);
    setStatus("done");
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    setFile(f);
    startHosting(f);
  };

  const reset = () => {
    cleanup();
    setFile(null);
    setPeerId("");
    setQr(null);
    setStatus("idle");
    setProgress(0);
    setErrorMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const copyId = async () => {
    if (!peerId) return;
    await navigator.clipboard.writeText(peerId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Left: file picker + status */}
      <Card className="p-6 space-y-4 bg-card/60 backdrop-blur border-border/60">
        <input
          ref={fileInputRef}
          type="file"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="hidden"
          id="file-input"
        />
        <label
          htmlFor="file-input"
          className="flex flex-col items-center justify-center gap-2 min-h-[220px] rounded-lg border-2 border-dashed border-border/80 bg-background/40 cursor-pointer hover:border-primary/60 transition-colors p-6 text-center"
        >
          {file ? (
            <>
              <div
                className="size-12 rounded-xl flex items-center justify-center"
                style={{ background: "var(--gradient-primary)" }}
              >
                <FileIcon className="size-6 text-primary-foreground" />
              </div>
              <p className="text-sm font-medium break-all max-w-full">
                {file.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)} · tap to choose another
              </p>
            </>
          ) : (
            <>
              <Upload className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">Choose any file to send</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Any size, maxx kheriwal any type. Sent peer-to-peer in chunks — quality
                stays bit-identical.
              </p>
            </>
          )}
        </label>

        {file && (
          <div className="space-y-3">
            {(status === "sending" || status === "done") && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {status === "done" ? "Transfer complete" : "Sending…"}
                  </span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}
            {status === "waiting" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Waiting for the other device to scan the QR…
              </div>
            )}
            {status === "connected" && (
              <div className="flex items-center gap-2 text-sm text-primary">
                <Wifi className="size-4" /> Connected — starting transfer…
              </div>
            )}
            {status === "done" && (
              <div className="flex items-center gap-2 text-sm text-primary">
                <Check className="size-4" /> File delivered successfully
              </div>
            )}
            {errorMsg && (
              <p className="text-sm text-destructive">{errorMsg}</p>
            )}
            <Button variant="outline" onClick={reset} className="w-full">
              <Trash2 className="size-4 mr-2" />
              {status === "done" ? "Send another file" : "Cancel"}
            </Button>
          </div>
        )}
      </Card>

      {/* Right: QR pairing code */}
      <Card className="p-6 flex flex-col items-center justify-center bg-card/60 backdrop-blur border-border/60 min-h-[380px]">
        {qr && status !== "done" ? (
          <div className="space-y-4 w-full flex flex-col items-center">
            <div
              className="rounded-2xl p-4 bg-white"
              style={{ boxShadow: "var(--shadow-glow)" }}
            >
              <img src={qr} alt="Pairing QR code" className="w-64 h-64 block" />
            </div>
            <p className="text-sm text-muted-foreground text-center max-w-xs">
              Scan this with the other phone camera. It opens receiver mode and
              pairs only with a connection code — the file is sent peer-to-peer.
            </p>
            <button
              type="button"
              onClick={copyId}
              className="text-xs font-mono px-3 py-1.5 rounded-md border border-border/60 bg-background/40 hover:bg-background/70 transition-colors flex items-center gap-2"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {peerId}
            </button>
          </div>
        ) : status === "done" ? (
          <div className="text-center space-y-3">
            <div
              className="mx-auto size-16 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--gradient-primary)" }}
            >
              <Check className="size-8 text-primary-foreground" />
            </div>
            <p className="font-medium">All done!</p>
            <p className="text-sm text-muted-foreground">
              {file?.name} was delivered to the other device.
            </p>
          </div>
        ) : (
          <div className="text-center space-y-3 text-muted-foreground">
            <div
              className="mx-auto size-16 rounded-2xl flex items-center justify-center"
              style={{ background: "var(--gradient-primary)" }}
            >
              <Upload className="size-8 text-primary-foreground" />
            </div>
            <p className="text-sm">Pick a file to generate a pairing code</p>
          </div>
        )}
      </Card>
    </div>
  );
}
