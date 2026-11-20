'use client';

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
          participantIdentity: `${userName}-${Math.floor(Math.random() * 1000)}`,
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
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
              layoutMode === 'gallery' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> 網格檢視
          </button>
          <button
            onClick={() => setLayoutMode('speaker')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
              layoutMode === 'speaker' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
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
      className={`relative h-full w-full overflow-hidden rounded-2xl bg-[#131A2B] transition-all duration-200 ${
        isSpeaking
          ? 'ring-2 ring-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.35)]'
          : 'border border-slate-800/90'
      }`}
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
      className={`flex flex-col items-center justify-center gap-1 rounded-xl px-4 py-2 text-xs transition ${
        highlight
          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40'
          : active
          ? 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
          : 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
      }`}
    >
      {icon}
      <span className="text-[11px]">{label}</span>
    </button>
  );
}
