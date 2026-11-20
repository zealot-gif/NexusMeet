import Fastify from 'fastify';
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
