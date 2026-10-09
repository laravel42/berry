'use client';

import { Button } from '@/components/ui/button';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
   computerHost,
   connectAiRuntime,
   type AiRuntimeConnection,
   type AiRuntimeDefinition,
} from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

const KIRO_API_KEY = /^ksk_[A-Za-z0-9_-]{8,256}$/;

type Step = 'details' | 'result';

/** A sealed provider key is required only when the catalog says the login is an API key. */
export function runtimeNeedsApiKey(runtime: AiRuntimeDefinition): boolean {
   return runtime.connectionMethods.some((method) => /api[_ ]?key/i.test(method));
}

function modelNames(connection: AiRuntimeConnection): string[] {
   const parsed = z
      .array(z.object({ id: z.string(), name: z.string() }))
      .safeParse(connection.metadata.models);
   return parsed.success ? parsed.data.map((model) => model.name) : [];
}

/**
 * Connects one available AI runtime.
 *
 * The first step is the connection itself: a name, the computer that exposes
 * the CLI, and an API key when that runtime's login is a key. A CLI that is
 * already signed in leaves the key out. The last step is the connection Berry
 * recorded, or the reason it refused.
 */
export function RuntimeConnectWizard({
   open,
   runtimes,
   initialRuntimeId,
   onOpenChange,
   onConnected,
}: {
   open: boolean;
   runtimes: AiRuntimeDefinition[];
   initialRuntimeId: string | null;
   onOpenChange: (open: boolean) => void;
   onConnected: () => void;
}) {
   const available = runtimes.filter((runtime) => runtime.availability === 'available');
   const runtimesRef = useRef(runtimes);
   runtimesRef.current = runtimes;
   const [runtimeId, setRuntimeId] = useState<string | null>(initialRuntimeId);
   const [name, setName] = useState('');
   const [host, setHost] = useState('localhost');
   const [step, setStep] = useState<Step>('details');
   const [apiKey, setApiKey] = useState('');
   const [pending, setPending] = useState(false);
   const [connection, setConnection] = useState<AiRuntimeConnection | null>(null);
   const [failure, setFailure] = useState<string | null>(null);

   useEffect(() => {
      if (!open) return;
      const choices = runtimesRef.current.filter((runtime) => runtime.availability === 'available');
      const initial = choices.find((runtime) => runtime.id === initialRuntimeId) ?? null;
      setRuntimeId(initial?.id ?? null);
      setName(initial?.name ?? '');
      setHost('localhost');
      setStep('details');
      setApiKey('');
      setPending(false);
      setConnection(null);
      setFailure(null);
   }, [open, initialRuntimeId]);

   const runtime = available.find((entry) => entry.id === runtimeId);
   const needsKey = runtime ? runtimeNeedsApiKey(runtime) : false;
   const keyValid =
      runtime?.id === 'kiro' ? KIRO_API_KEY.test(apiKey.trim()) : apiKey.trim() !== '';
   const nameValid = name.trim() !== '';
   const normalizedHost = computerHost(host);
   const canConnect =
      Boolean(runtime) && nameValid && normalizedHost !== null && (!needsKey || keyValid);

   const connect = async () => {
      if (!runtime || !canConnect) return;
      setStep('result');
      setPending(true);
      setConnection(null);
      setFailure(null);
      try {
         const recorded = await connectAiRuntime(runtime.id, {
            name: name.trim(),
            host: normalizedHost ?? host.trim(),
            ...(needsKey ? { apiKey: apiKey.trim() } : {}),
         });
         setConnection(recorded);
         onConnected();
      } catch (error) {
         setFailure(error instanceof Error ? error.message : `${runtime.name} could not connect.`);
      } finally {
         setPending(false);
      }
   };

   return (
      <Dialog open={open} onOpenChange={pending ? () => undefined : onOpenChange}>
         <DialogContent className="sm:max-w-lg">
            <DialogHeader>
               <DialogTitle>Connect an AI runtime</DialogTitle>
               <DialogDescription>
                  {step === 'details' ? 'Connection' : 'Result'} · step {step === 'details' ? 1 : 2}{' '}
                  of 2
               </DialogDescription>
            </DialogHeader>

            <ol className="flex gap-2" aria-label="Connection steps">
               {(['details', 'result'] as const).map((entry) => {
                  const current = entry === step;
                  const done = entry === 'details' && step === 'result';
                  return (
                     <li
                        key={entry}
                        aria-current={current ? 'step' : undefined}
                        className={cn(
                           'flex-1 rounded-md border px-2 py-1 text-center',
                           current
                              ? 'border-primary bg-primary/5 text-foreground'
                              : done
                                ? 'border-status-success/40 text-status-success'
                                : 'border-border text-muted-foreground'
                        )}
                     >
                        {entry === 'details' ? 'Connection' : 'Result'}
                     </li>
                  );
               })}
            </ol>

            {step === 'details' ? (
               <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                     <Label htmlFor="runtime-connection-name">Connection name</Label>
                     <Input
                        id="runtime-connection-name"
                        value={name}
                        maxLength={80}
                        autoComplete="off"
                        onChange={(event) => setName(event.target.value)}
                     />
                  </div>
                  <div className="flex flex-col gap-1.5">
                     <Label htmlFor="runtime-connection-host">Host</Label>
                     <Input
                        id="runtime-connection-host"
                        value={host}
                        maxLength={253}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="localhost"
                        onChange={(event) => setHost(event.target.value)}
                     />
                     {host.trim() !== '' && normalizedHost === null ? (
                        <p className="text-status-danger">
                           Use localhost or a fully qualified domain name.
                        </p>
                     ) : (
                        <p className="text-muted-foreground">
                           The computer that exposes the {runtime?.name ?? 'CLI'}.
                        </p>
                     )}
                  </div>
                  {needsKey && runtime ? (
                     <div className="flex flex-col gap-1.5">
                        <Label htmlFor="runtime-connection-key">API key</Label>
                        <Input
                           id="runtime-connection-key"
                           type="password"
                           autoComplete="off"
                           spellCheck={false}
                           placeholder={runtime.id === 'kiro' ? 'ksk_…' : 'API key'}
                           value={apiKey}
                           onChange={(event) => setApiKey(event.target.value)}
                        />
                        {apiKey.trim() !== '' && !keyValid ? (
                           <p className="text-status-danger">
                              {runtime.id === 'kiro'
                                 ? 'A Kiro key starts with ksk_.'
                                 : 'Enter the API key for this host.'}
                           </p>
                        ) : null}
                     </div>
                  ) : null}
               </div>
            ) : null}

            {step === 'result' && runtime ? (
               <div className="flex flex-col gap-2">
                  {pending ? (
                     <p className="text-muted-foreground">
                        Checking {runtime.name} on {normalizedHost ?? host.trim()}…
                     </p>
                  ) : null}
                  {connection ? (
                     <>
                        <p className="text-status-success">
                           {name.trim()} on {normalizedHost ?? host.trim()} is connected
                           {connection.accountName ? ` as ${connection.accountName}` : ''}. Usage
                           stays on this account.
                        </p>
                        <p className="text-muted-foreground">
                           {modelNames(connection).length > 0
                              ? `${modelNames(connection).length} models are available for the tiers.`
                              : 'Berry will use the models this host reports.'}
                        </p>
                     </>
                  ) : null}
                  {failure ? <p className="text-status-danger">{failure}</p> : null}
               </div>
            ) : null}

            <DialogFooter className="sm:justify-between">
               {step === 'details' ? (
                  <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                     Cancel
                  </Button>
               ) : connection ? (
                  <span />
               ) : (
                  <Button
                     variant="ghost"
                     size="sm"
                     disabled={pending}
                     onClick={() => setStep('details')}
                  >
                     Back
                  </Button>
               )}
               {step === 'result' && connection ? (
                  <Button size="sm" onClick={() => onOpenChange(false)}>
                     Done
                  </Button>
               ) : step === 'result' ? (
                  <Button
                     size="sm"
                     disabled={pending || !canConnect}
                     onClick={() => void connect()}
                  >
                     {pending ? 'Connecting…' : 'Try again'}
                  </Button>
               ) : (
                  <Button size="sm" disabled={!canConnect} onClick={() => void connect()}>
                     Connect
                  </Button>
               )}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
