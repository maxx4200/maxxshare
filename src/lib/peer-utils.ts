// Shared helpers for the WebRTC file-transfer pair.

export const CHUNK_SIZE = 64 * 1024; // 64KB chunks — safe for RTCDataChannel

// Reliable public STUN servers. Without explicit ICE config, PeerJS defaults
// can fail on mobile carriers / strict NATs.
export const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ],
  },
};

export type FileMeta = {
  type: "meta";
  name: string;
  size: number;
  mime: string;
};

export type FileDone = {
  type: "done";
};

export type ControlMessage = FileMeta | FileDone;

export function parsePeerCode(rawCode: string): string {
  const value = rawCode.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.searchParams.get("peer")?.trim() || value;
  } catch {
    return value.replace(/^beamshare:/, "").trim();
  }
}

export function newPeerId(): string {
  // Numeric-only pairing code — easy to type on mobile.
  // 9 digits split as 3-3-3 for readability.
  const part = () => Math.floor(100 + Math.random() * 900).toString();
  return `${part()}-${part()}-${part()}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
