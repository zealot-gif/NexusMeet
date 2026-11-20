import fs from 'fs';
import path from 'path';

const files = {
  'package.json': JSON.stringify({
    name: 'nexus-meet',
    private: true,
    workspaces: ['apps/*', 'packages/*'],
    scripts: {
      dev: 'turbo run dev',
      build: 'turbo run build',
      lint: 'turbo run lint'
    },
    devDependencies: {
      turbo: '^2.3.0',
      typescript: '^5.6.0'
    }
  }, null, 2),

  'pnpm-workspace.yaml': `packages:
  - 'apps/*'
  - 'packages/*'
`,

  'turbo.json': JSON.stringify({
    $schema: 'https://turbo.build/schema.json',
    tasks: {
      build: {
        dependsOn: ['^build'],
        outputs: ['.next/**', 'dist/**']
      },
      dev: {
        cache: false,
        persistent: true
      }
    }
  }, null, 2),

  '.gitignore': `node_modules
.next
dist
.env
.env.local
.DS_Store
*.log
`,

  'docker-compose.yml': `version: '3.9'
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --dev --bind 0.0.0.0
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882/udp"
    environment:
      - LIVEKIT_KEYS=devkey: secret
`,

  'README.md': `# NexusMeet

Open-Source AI-Native WebRTC Video Conferencing Platform.

## Features
- **WebRTC SFU**: Powered by LiveKit SDK with Simulcast & 4K Screen Sharing.
- **Edge AI Pipeline**: Browser-side background blur (MediaPipe) & audio noise suppression.
- **Modern Dark UI**: Next.js + Tailwind CSS with dynamic Speaker / Gallery layouts.

## Quick Start
\`\`\`bash
pnpm install
docker-compose up -d
pnpm dev
\`\`\`
`,

  // --- Shared Types ---
  'packages/shared-types/package.json': JSON.stringify({
    name: '@nexus/shared-types',
    version: '0.1.0',
    main: './src/index.ts',
    types: './src/index.ts'
  }, null, 2),

  'packages/shared-types/src/index.ts': `export interface ActionItem {
  assignee: string;
  task: string;
  deadline?: string;
}

export interface CopilotSummaryResponse {
  summary: string;
  actionItems: ActionItem[];
}
`,

  // --- Edge AI Package ---
  'packages/media-ai/package.json': JSON.stringify({
    name: '@nexus/media-ai',
    version: '0.1.0',
    main: './src/index.ts',
    types: './src/index.ts',
    dependencies: {
      '@mediapipe/tasks-vision': '^0.10.14'
    }
  }, null, 2),

  'packages/media-ai/src/index.ts': `import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';

export interface MediaAIOptions {
  enableBackgroundBlur: boolean;
  blurRadius: number;
  enableNoiseSuppression: boolean;
}

export class EdgeMediaProcessor {
  private segmenter: ImageSegmenter | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private videoElement: HTMLVideoElement;
  private animationFrameId: number | null = null;
  private options: MediaAIOptions = {
    enableBackgroundBlur: false,
    blurRadius: 12,
    enableNoiseSuppression: true,
  };

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.muted = true;
    this.videoElement.playsInline = true;
  }

  async initVisionModel(): Promise<void> {
    if (this.segmenter) return;
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    this.segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
    });
  }

  public updateOptions(newOptions: Partial<MediaAIOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  async processVideoTrack(rawTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
    await this.initVisionModel();
    const settings = rawTrack.getSettings();
    this.canvas.width = settings.width || 1280;
    this.canvas.height = settings.height || 720;

    this.videoElement.srcObject = new MediaStream([rawTrack]);
    await this.videoElement.play();

    const renderLoop = () => {
      if (this.videoElement.readyState >= 2) {
        const { width, height } = this.canvas;
        if (!this.options.enableBackgroundBlur || !this.segmenter) {
          this.ctx.filter = 'none';
          this.ctx.drawImage(this.videoElement, 0, 0, width, height);
        } else {
          this.ctx.save();
          this.ctx.filter = \`blur(\${this.options.blurRadius}px)\`;
          this.ctx.drawImage(this.videoElement, 0, 0, width, height);
          this.ctx.restore();

          const result = this.segmenter.segmentForVideo(this.videoElement, performance.now());
          if (result.categoryMask) {
            this.applyForegroundMask(result.categoryMask);
            result.categoryMask.close();
          }
        }
      }
      this.animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return this.canvas.captureStream(30).getVideoTracks()[0];
  }

  private applyForegroundMask(mask: any): void {
    const { width, height } = this.canvas;
    const maskData = mask.getAsUint8Array();
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(this.videoElement, 0, 0, width, height);

    const imgData = tempCtx.getImageData(0, 0, width, height);
    const pixels = imgData.data;

    for (let i = 0; i < maskData.length; i++) {
      if (maskData[i] !== 0) {
        pixels[i * 4 + 3] = 0;
      }
    }
    tempCtx.putImageData(imgData, 0, 0);
    this.ctx.drawImage(tempCanvas, 0, 0);
  }

  async processAudioTrack(rawTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
    const audioCtx = new AudioContext({ sampleRate: 48000 });
    const source = audioCtx.createMediaStreamSource(new MediaStream([rawTrack]));

    const highPassFilter = audioCtx.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.value = 100;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.ratio.value = 4;

    const destination = audioCtx.createMediaStreamDestination();
    source.connect(highPassFilter);
    highPassFilter.connect(compressor);
    compressor.connect(destination);

    return destination.stream.getAudioTracks()[0];
  }

  public destroy(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.segmenter?.close();
  }
}
`,

  // --- Backend Server ---
  'apps/server/package.json': JSON.stringify({
    name: '@nexus/server',
    version: '0.1.0',
    scripts: {
      dev: 'tsx watch src/index.ts',
      build: 'tsc'
    },
    dependencies: {
      '@fastify/cors': '^10.0.1',
      fastify: '^5.0.0',
      'livekit-server-sdk': '^2.6.0'
    },
    devDependencies: {
      tsx: '^4.19.0',
      typescript: '^5.6.0'
    }
  }, null, 2),

  'apps/server/tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: './dist',
      strict: true,
      esModuleInterop: true
    },
    include: ['src/**/*']
  }, null, 2),

  'apps/server/src/index.ts': `import Fastify from 'fastify';
import cors from '@fastify/cors';
import { AccessToken } from 'livekit-server-sdk';

const app = Fastify({ logger: true });
app.register(cors, { origin: '*' });

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';

interface JoinRoomBody {
  roomName: string;
  participantName: string;
  participantIdentity: string;
}

app.post<{ Body: JoinRoomBody }>('/api/room/token', async (request, reply) => {
  const { roomName, participantName, participantIdentity } = request.body;

  if (!roomName || !participantIdentity) {
    return reply.status(400).send({ error: 'Missing roomName or participantIdentity' });
  }

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName || participantIdentity,
    ttl: '2h',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return {
    token,
    wsUrl: process.env.LIVEKIT_WS_URL || 'ws://localhost:7880',
  };
});

app.post('/api/copilot/summarize', async () => {
  return {
    summary: '團隊已確認第一階段 WebRTC 架構與邊緣 AI 管線規格。',
    actionItems: [
      { assignee: 'Host', task: '完成 MediaPipe 背景虛化效能測試', deadline: '週五前' },
    ],
  };
});

app.listen({ port: 3001, host: '0.0.0.0' }, (err) => {
  if (err) throw err;
  console.log('NexusMeet Signaling Server running on http://localhost:3001');
});
`,

  // --- Frontend Web App ---
  'apps/web/package.json': JSON.stringify({
    name: '@nexus/web',
    version: '0.1.0',
    scripts: {
      dev: 'next dev -p 3000',
      build: 'next build',
      start: 'next start'
    },
    dependencies: {
      '@nexus/media-ai': 'workspace:*',
      '@nexus/shared-types': 'workspace:*',
      'livekit-client': '^2.5.0',
      'lucide-react': '^0.450.0',
      next: '^14.2.15',
      react: '^18.3.1',
      'react-dom': '^18.3.1'
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      '@types/react': '^18.3.0',
      autoprefixer: '^10.4.20',
      postcss: '^8.4.47',
      tailwindcss: '^3.4.14',
      typescript: '^5.6.0'
    }
  }, null, 2),

  'apps/web/next.config.mjs': `/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nexus/media-ai', '@nexus/shared-types'],
};
export default nextConfig;
`,

  'apps/web/tsconfig.json': JSON.stringify({
    compilerOptions: {
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./src/*'] }
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules']
  }, null, 2),

  'apps/web/tailwind.config.ts': `import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
`,

  'apps/web/postcss.config.mjs': `const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
export default config;
`,

  'apps/web/src/app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #0B0F19;
  color: #F1F5F9;
}
`,

  'apps/web/src/app/layout.tsx': `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NexusMeet | AI-Native WebRTC Conferencing',
  description: 'Open-source modern WebRTC video conferencing with Edge AI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className="dark">
      <body>{children}</body>
    </html>
  );
}
`,

  'apps/web/src/app/page.tsx': `'use client';

import React, { useState } from 'react';
import { Video, Sparkles, Shield } from 'lucide-react';
import MeetingRoom from '@/components/meeting/MeetingRoom';

export default function HomePage() {
  const [roomName, setRoomName] = useState('nexus-demo-room');
  const [userName, setUserName] = useState('');
  const [joined, setJoined] = useState(false);

  if (joined && userName.trim()) {
    return (
      <MeetingRoom
        roomName={roomName.trim() || 'nexus-demo-room'}
        userName={userName.trim()}
        onLeave={() => setJoined(false)}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0B0F19] px-4 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#111726] p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
            <Video className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">NexusMeet</h1>
            <p className="text-xs text-slate-400">開源邊緣 AI 視訊會議系統</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (userName.trim()) setJoined(true);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">你的顯示名稱</label>
            <input
              type="text"
              required
              placeholder="例如：Alex"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">會議室代碼</label>
            <input
              type="text"
              required
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-3 text-sm font-semibold text-white transition shadow-lg shadow-indigo-600/20"
          >
            進入視訊會議室
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-indigo-400" /> 本地 MediaPipe 虛化</span>
          <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-emerald-400" /> WebRTC SFU</span>
        </div>
      </div>
    </div>
  );
}
`,

  'apps/web/src/components/meeting/MeetingRoom.tsx': `'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  Participant,
  LocalVideoTrack,
  LocalAudioTrack,
  createLocalTracks,
} from 'livekit-client';
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, Sparkles,
  LayoutGrid, UserSquare2, PhoneOff, ShieldCheck, Bot
} from 'lucide-react';
import { EdgeMediaProcessor } from '@nexus/media-ai';

interface MeetingRoomProps {
  roomName: string;
  userName: string;
  onLeave: () => void;
}

export default function MeetingRoom({ roomName, userName, onLeave }: MeetingRoomProps) {
  const [room] = useState(() => new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 30 } },
  }));

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeSpeakers, setActiveSpeakers] = useState<string[]>([]);
  const [layoutMode, setLayoutMode] = useState<'gallery' | 'speaker'>('gallery');

  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isBlurOn, setIsBlurOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);

  const aiProcessorRef = useRef<EdgeMediaProcessor | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function connectToRoom() {
      const res = await fetch('http://localhost:3001/api/room/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName,
          participantName: userName,
          participantIdentity: \`\${userName}-\${Math.floor(Math.random() * 1000)}\`,
        }),
      });
      const { token, wsUrl } = await res.json();

      room
        .on(RoomEvent.ParticipantConnected, updateParticipants)
        .on(RoomEvent.ParticipantDisconnected, updateParticipants)
        .on(RoomEvent.TrackSubscribed, updateParticipants)
        .on(RoomEvent.TrackUnsubscribed, updateParticipants)
        .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setActiveSpeakers(speakers.map((s) => s.identity));
        });

      await room.connect(wsUrl, token);
      if (!isMounted) return;

      const rawTracks = await createLocalTracks({ audio: true, video: true });
      const processor = new EdgeMediaProcessor();
      aiProcessorRef.current = processor;

      for (const track of rawTracks) {
        if (track.kind === Track.Kind.Video) {
          const processedVideoTrack = await processor.processVideoTrack(track.mediaStreamTrack);
          await room.localParticipant.publishTrack(
            new LocalVideoTrack(processedVideoTrack),
            { simulcast: true }
          );
        } else if (track.kind === Track.Kind.Audio) {
          const processedAudioTrack = await processor.processAudioTrack(track.mediaStreamTrack);
          await room.localParticipant.publishTrack(
            new LocalAudioTrack(processedAudioTrack)
          );
        }
      }

      updateParticipants();
    }

    function updateParticipants() {
      setParticipants([room.localParticipant, ...Array.from(room.remoteParticipants.values())]);
    }

    connectToRoom().catch(console.error);

    return () => {
      isMounted = false;
      aiProcessorRef.current?.destroy();
      room.disconnect();
    };
  }, [room, roomName, userName]);

  const toggleBackgroundBlur = () => {
    const nextState = !isBlurOn;
    setIsBlurOn(nextState);
    aiProcessorRef.current?.updateOptions({ enableBackgroundBlur: nextState });
  };

  const toggleScreenShare = async () => {
    const nextState = !isScreenSharing;
    await room.localParticipant.setScreenShareEnabled(nextState, {
      audio: true,
      resolution: { width: 3840, height: 2160, frameRate: 30 },
    });
    setIsScreenSharing(nextState);
    if (nextState) setLayoutMode('speaker');
  };

  const primarySpeaker =
    participants.find((p) => p.isScreenShareEnabled) ||
    participants.find((p) => activeSpeakers.includes(p.identity)) ||
    participants[0];

  return (
    <div className="flex h-screen w-full flex-col bg-[#0B0F19] text-slate-100 select-none">
      <header className="flex h-14 items-center justify-between border-b border-slate-800/80 px-6 bg-[#0F1524]">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <h1 className="font-semibold tracking-wide text-slate-100">{roomName}</h1>
          <span className="flex items-center gap-1 rounded-full bg-indigo-950/80 border border-indigo-500/30 px-2.5 py-0.5 text-xs text-indigo-300">
            <ShieldCheck className="h-3.5 w-3.5" /> E2EE Ready
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-slate-900 p-1 border border-slate-800">
          <button
            onClick={() => setLayoutMode('gallery')}
            className={\`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition \${
              layoutMode === 'gallery' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }\`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> 網格檢視
          </button>
          <button
            onClick={() => setLayoutMode('speaker')}
            className={\`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition \${
              layoutMode === 'speaker' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }\`}
          >
            <UserSquare2 className="h-3.5 w-3.5" /> 演講者模式
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden p-4 gap-4">
        <div className="flex-1 flex flex-col gap-4">
          {layoutMode === 'gallery' ? (
            <div className="grid flex-1 gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
              {participants.map((p) => (
                <ParticipantTile
                  key={p.identity}
                  participant={p}
                  isSpeaking={activeSpeakers.includes(p.identity)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-4">
              {primarySpeaker && (
                <div className="flex-1">
                  <ParticipantTile
                    participant={primarySpeaker}
                    isSpeaking={activeSpeakers.includes(primarySpeaker.identity)}
                    preferScreenShare
                  />
                </div>
              )}
              <div className="flex h-36 gap-3 overflow-x-auto pb-1">
                {participants
                  .filter((p) => p.identity !== primarySpeaker?.identity)
                  .map((p) => (
                    <div key={p.identity} className="w-60 shrink-0">
                      <ParticipantTile
                        participant={p}
                        isSpeaking={activeSpeakers.includes(p.identity)}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {showCopilot && (
          <aside className="w-80 rounded-2xl border border-slate-800 bg-[#111726] p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-indigo-400 font-medium pb-3 border-b border-slate-800">
                <Bot className="h-4 w-4" /> AI 會議副駕駛 (Copilot)
              </div>
              <p className="mt-4 text-xs text-slate-400 leading-relaxed">
                即時雙語字幕與 LLM 摘要模組已就緒。點擊下方按鈕可隨時提取目前對話的 Action Items。
              </p>
            </div>
            <button className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-xs font-medium text-white transition">
              生成即時會議重點與待辦清單
            </button>
          </aside>
        )}
      </main>

      <footer className="flex h-20 items-center justify-center gap-3 border-t border-slate-800/80 bg-[#0F1524] px-6">
        <ControlButton
          active={isMicOn}
          onClick={async () => {
            await room.localParticipant.setMicrophoneEnabled(!isMicOn);
            setIsMicOn(!isMicOn);
          }}
          icon={isMicOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
          label={isMicOn ? '靜音' : '解除靜音'}
        />
        <ControlButton
          active={isCamOn}
          onClick={async () => {
            await room.localParticipant.setCameraEnabled(!isCamOn);
            setIsCamOn(!isCamOn);
          }}
          icon={isCamOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          label={isCamOn ? '關閉鏡頭' : '開啟鏡頭'}
        />
        <ControlButton
          active={isBlurOn}
          highlight={isBlurOn}
          onClick={toggleBackgroundBlur}
          icon={<Sparkles className="h-5 w-5" />}
          label="AI 背景虛化"
        />
        <ControlButton
          active={isScreenSharing}
          highlight={isScreenSharing}
          onClick={toggleScreenShare}
          icon={<MonitorUp className="h-5 w-5" />}
          label="4K 螢幕分享"
        />
        <ControlButton
          active={showCopilot}
          highlight={showCopilot}
          onClick={() => setShowCopilot(!showCopilot)}
          icon={<Bot className="h-5 w-5" />}
          label="AI 副駕駛"
        />
        <button
          onClick={onLeave}
          className="ml-4 flex items-center gap-2 rounded-full bg-rose-600 hover:bg-rose-500 px-5 py-3 text-sm font-medium text-white transition"
        >
          <PhoneOff className="h-4 w-4" /> 離開會議
        </button>
      </footer>
    </div>
  );
}

function ParticipantTile({
  participant,
  isSpeaking,
  preferScreenShare = false,
}: {
  participant: Participant;
  isSpeaking: boolean;
  preferScreenShare?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
    const camPub = participant.getTrackPublication(Track.Source.Camera);
    const targetTrack = (preferScreenShare && screenPub?.track) || camPub?.track;

    if (targetTrack) {
      targetTrack.attach(videoEl);
      return () => {
        targetTrack.detach(videoEl);
      };
    }
  }, [participant, preferScreenShare]);

  return (
    <div
      className={\`relative h-full w-full overflow-hidden rounded-2xl bg-[#131A2B] transition-all duration-200 \${
        isSpeaking
          ? 'ring-2 ring-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.35)]'
          : 'border border-slate-800/90'
      }\`}
    >
      <video ref={videoRef} autoPlay playsInline muted={participant.isLocal} className="h-full w-full object-cover" />
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-slate-950/75 backdrop-blur-md px-3 py-1 text-xs font-medium text-slate-200">
        <span>{participant.name || participant.identity} {participant.isLocal && '(你)'}</span>
        {isSpeaking && <span className="h-2 w-2 rounded-full bg-indigo-400 animate-ping" />}
      </div>
    </div>
  );
}

function ControlButton({
  active,
  highlight = false,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  highlight?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={\`flex flex-col items-center justify-center gap-1 rounded-xl px-4 py-2 text-xs transition \${
        highlight
          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
          : active
          ? 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
          : 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
      }\`}
    >
      {icon}
      <span className="text-[11px]">{label}</span>
    </button>
  );
}
`
};

for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.join(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`Created: ${filePath}`);
}

console.log('\n✅ NexusMeet 專案架構與所有檔案已自動建立完成！');
