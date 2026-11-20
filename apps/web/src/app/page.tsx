'use client';

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
