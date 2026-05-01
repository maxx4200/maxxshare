import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { QRSender } from "@/components/QRSender";
import { QRReceiver } from "@/components/QRReceiver";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrCode, Send, ScanLine, WifiOff } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "BeamShare — Offline QR Data Sharing" },
      {
        name: "description",
        content:
          "Share text, links and data between devices instantly using QR codes. Works offline, no accounts, no servers.",
      },
    ],
  }),
});

function Index() {
  const [tab, setTab] = useState("send");
  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--gradient-bg)" }}
    >
      <div className="max-w-5xl mx-auto px-4 py-10 md:py-16">
        <header className="text-center space-y-4 mb-10">
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium border border-border/60 bg-card/40 backdrop-blur"
          >
            <WifiOff className="size-3.5" />
            Peer-to-peer · any file size
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "var(--gradient-primary)" }}
            >
              BeamShare
            </span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto text-base md:text-lg">
            Scan a QR code to pair two devices, then send files of any size
            directly between them — lossless and quality-perfect.
          </p>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid grid-cols-2 max-w-sm mx-auto mb-8 bg-card/60 backdrop-blur border border-border/60 h-12">
            <TabsTrigger value="send" className="gap-2 h-full">
              <Send className="size-4" /> Send
            </TabsTrigger>
            <TabsTrigger value="receive" className="gap-2 h-full">
              <ScanLine className="size-4" /> Receive
            </TabsTrigger>
          </TabsList>
          <TabsContent value="send">
            <QRSender />
          </TabsContent>
          <TabsContent value="receive">
            <QRReceiver />
          </TabsContent>
        </Tabs>

        <footer className="mt-16 text-center text-xs text-muted-foreground flex items-center justify-center gap-2 max-w-xl mx-auto px-4">
          <QrCode className="size-3.5 shrink-0" />
          <span>
            Open this same URL on both devices. Scan the QR <em>inside</em>{" "}
            the Receive tab — not with your camera app.
          </span>
        </footer>
      </div>
    </div>
  );
}
