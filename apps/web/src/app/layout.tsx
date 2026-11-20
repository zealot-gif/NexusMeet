import type { Metadata } from 'next';
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
