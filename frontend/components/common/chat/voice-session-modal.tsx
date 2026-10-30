'use client';

import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import {
   BarVisualizer,
   LiveKitRoom,
   RoomAudioRenderer,
   StartAudio,
   VoiceAssistantControlBar,
   useChat,
   useRoomContext,
   useVoiceAssistant,
   type AgentState,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Room, RoomEvent } from 'livekit-client';
import { useTranslations } from 'next-intl';

import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import { createVoiceToken, type VoiceToken } from '@/lib/voice';

/**
 * A LiveKit voice room for one workspace agent.
 *
 * Berry mints the join token. The modal uses LiveKit's own session controls
 * and bar visualizer so a member talks in the same UX as a LiveKit agent
 * starter, without a LiveKit secret in the browser.
 */

export function VoiceSessionModal({
   open,
   onOpenChange,
   workspaceId,
   agentId,
   agentName,
   conversationId,
}: {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   workspaceId: string;
   agentId: string;
   agentName: string;
   conversationId?: string | null;
}) {
   const t = useTranslations('agentsChat.voice');
   const [session, setSession] = useState<VoiceToken | null>(null);
   const [error, setError] = useState<string | null>(null);

   useEffect(() => {
      if (!open) {
         setSession(null);
         setError(null);
         return;
      }
      let cancelled = false;
      setSession(null);
      setError(null);
      void createVoiceToken({ workspaceId, agentId, conversationId })
         .then((token) => {
            if (!cancelled) setSession(token);
         })
         .catch((cause) => {
            if (cancelled) return;
            setError(cause instanceof BerryApiError ? cause.message : t('failed'));
         });
      return () => {
         cancelled = true;
      };
   }, [open, workspaceId, agentId, conversationId, t]);

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent
            className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-2xl"
            showCloseButton
         >
            <DialogHeader>
               <DialogTitle>{t('title', { name: agentName })}</DialogTitle>
               <DialogDescription>{t('hint')}</DialogDescription>
            </DialogHeader>
            {error ? (
               <p className="text-status-danger" role="alert">
                  {error}
               </p>
            ) : session === null ? (
               <p className="text-muted-foreground">{t('connecting')}</p>
            ) : (
               <LiveKitRoom
                  serverUrl={session.url}
                  token={session.token}
                  connect
                  audio
                  video={false}
                  onDisconnected={() => onOpenChange(false)}
                  onError={() => setError(t('failed'))}
                  onMediaDeviceFailure={() => setError(t('failed'))}
                  className="flex flex-col gap-4"
                  style={
                     {
                        '--lk-fg': 'var(--foreground)',
                        '--lk-va-bg': 'var(--muted)',
                     } as CSSProperties
                  }
                  data-lk-theme="default"
               >
                  <VoiceSessionSurface />
                  <RoomAudioRenderer />
                  <StartAudio label={t('startAudio')} />
               </LiveKitRoom>
            )}
         </DialogContent>
      </Dialog>
   );
}

function virtualMicrophone(label: string): boolean {
   return /virtual|teams audio device|cable input|blackhole|loopback|aggregate/i.test(label);
}

function usePhysicalMicrophone() {
   const room = useRoomContext();
   const [virtual, setVirtual] = useState(false);

   useEffect(() => {
      let cancelled = false;
      const prefer = async () => {
         const devices = await Room.getLocalDevices('audioinput');
         const real = devices.filter((device) => !virtualMicrophone(device.label));
         const active = room.getActiveDevice('audioinput');
         const activeLabel = devices.find((device) => device.deviceId === active)?.label ?? '';
         if (!cancelled)
            setVirtual(activeLabel !== '' && virtualMicrophone(activeLabel) && real.length > 0);
         if (active && !virtualMicrophone(activeLabel)) return;
         const next = real[0];
         if (!next || cancelled) return;
         await room.switchActiveDevice('audioinput', next.deviceId, true);
         if (!cancelled) setVirtual(false);
      };
      void prefer();
      room.on(RoomEvent.MediaDevicesChanged, prefer);
      return () => {
         cancelled = true;
         room.off(RoomEvent.MediaDevicesChanged, prefer);
      };
   }, [room]);

   return virtual;
}

function VoiceSessionSurface() {
   const { state, audioTrack } = useVoiceAssistant();
   const { send, isSending } = useChat();
   const virtualMic = usePhysicalMicrophone();
   const t = useTranslations('agentsChat.voice');
   const [draft, setDraft] = useState('');

   const onSay = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const line = draft.trim();
      if (!line || isSending) return;
      setDraft('');
      void send(line);
   };

   return (
      <>
         <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/20 px-4 py-6">
            <BarVisualizer
               state={state}
               track={audioTrack}
               barCount={5}
               options={{ minHeight: 20, maxHeight: 80 }}
               className="!h-24 w-full max-w-sm"
            />
            <p className="text-muted-foreground">
               {agentStateLabel(state, {
                  thinking: t('thinking'),
                  speaking: t('speaking'),
                  listening: t('listening'),
                  failed: t('failed'),
                  connecting: t('connecting'),
               })}
            </p>
            {virtualMic ? <p className="text-status-danger">{t('micVirtual')}</p> : null}
         </div>
         <form className="flex gap-2" onSubmit={onSay}>
            <Input
               value={draft}
               onChange={(event) => setDraft(event.target.value)}
               placeholder={t('sayPlaceholder')}
               aria-label={t('sayPlaceholder')}
               disabled={isSending}
            />
            <Button type="submit" variant="soft" disabled={isSending || draft.trim() === ''}>
               {t('say')}
            </Button>
         </form>
         <VoiceAssistantControlBar controls={{ microphone: true, leave: true }} />
      </>
   );
}

function agentStateLabel(
   state: AgentState,
   labels: {
      thinking: string;
      speaking: string;
      listening: string;
      failed: string;
      connecting: string;
   }
): string {
   if (state === 'thinking') return labels.thinking;
   if (state === 'speaking') return labels.speaking;
   if (state === 'listening') return labels.listening;
   if (state === 'failed') return labels.failed;
   if (state === 'connecting' || state === 'initializing' || state === 'pre-connect-buffering') {
      return labels.connecting;
   }
   return labels.listening;
}
