'use client';

import { PickerRowIcon } from '@/components/common/pickers/option-picker';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Project } from '@/data/projects';
import { BerryApiError } from '@/lib/api';
import {
   createGitHubRepository,
   createGitLabRepository,
   loadGitHubRepositories,
   loadGitLabRepositories,
   loadGitLabRepositoryOwners,
   loadRepositoryOwners,
   setProjectRepository,
   type GitHubAccess,
   type GitHubRepository,
   type RepositoryOwner,
   type ScmProvider,
} from '@/lib/projects';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { loadProviders } from '@/lib/integrations';
import { cn } from '@/lib/utils';
import { useProjectsStore } from '@/store/projects-store';
import { useSessionStore } from '@/store/session-store';
import { Check, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { RiGithubFill, RiGitlabFill } from '@remixicon/react';
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { toast } from 'sonner';

export type RepositoryChoice = { provider: ScmProvider; fullName: string };

type ListedRepository = GitHubRepository & { provider: ScmProvider };

/** How many repositories the idle picker shows before the person searches. */
const IDLE_LIST_LIMIT = 20;

/** Which SCM hosts this workspace can list repositories from. */
function useConnectedScm(): { github: boolean; gitlab: boolean; ready: boolean } {
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const [state, setState] = useState({ github: false, gitlab: false, ready: false });

   useEffect(() => {
      if (!workspaceId) {
         setState({ github: false, gitlab: false, ready: true });
         return;
      }
      let cancelled = false;
      void loadProviders(workspaceId).then((providers) => {
         if (cancelled) return;
         setState({
            github: providers.some((provider) => provider.id === 'github' && provider.connected),
            gitlab: providers.some((provider) => provider.id === 'gitlab' && provider.connected),
            ready: true,
         });
      });
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   return state;
}

function ScmMark({ provider, className }: { provider: ScmProvider; className?: string }) {
   return provider === 'gitlab' ? (
      <RiGitlabFill className={className} />
   ) : (
      <RiGithubFill className={className} />
   );
}

/**
 * Chooses a GitHub or GitLab repository, over a plain value.
 *
 * Split from the project-bound wrapper below because the create dialog has no
 * project to update yet — it holds a pending choice until the project exists.
 * Both need the same list, search and failure states, and having two would mean
 * one of them quietly falling behind.
 *
 * The list is loaded when the picker opens rather than with the page. It costs
 * an upstream call and most people looking at a project are not relinking it,
 * so paying for it on every view would be a request nobody asked for.
 */
export function RepositoryPicker({
   value,
   valueProvider,
   onSelect,
   disabled,
   pending = false,
   placeholder = 'Link a repository',
   variant = 'ghost',
   size = 'sm',
   className = 'w-full px-0',
   side,
}: {
   value?: string;
   /** Which host the current value came from; defaults to GitHub when omitted. */
   valueProvider?: ScmProvider;
   onSelect: (choice: RepositoryChoice | null) => void;
   disabled?: boolean;
   /** A save in progress. The trigger shows a spinner instead of the mark. */
   pending?: boolean;
   placeholder?: string;
   /** Trigger styling. The project view wants a quiet full-width row; a form
    *  row of property buttons wants the same gray, auto-width chip as its
    *  siblings — so the caller decides, and the default keeps the row. */
   variant?: ComponentProps<typeof Button>['variant'];
   size?: ComponentProps<typeof Button>['size'];
   className?: string;
   /** Where the list opens. The project row opens downward; chat opens up. */
   side?: 'top' | 'bottom';
}) {
   const [open, setOpen] = useState(false);
   const [repositories, setRepositories] = useState<ListedRepository[]>([]);
   const [access, setAccess] = useState<GitHubAccess | null>(null);
   const [loading, setLoading] = useState(false);
   const [loaded, setLoaded] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [creating, setCreating] = useState(false);
   const [query, setQuery] = useState('');
   const connected = useConnectedScm();
   const activeProvider: ScmProvider = valueProvider ?? 'github';

   // The list is loaded once per opening and kept. Reload stays out of the
   // search row until that request ends, then it is there to fetch again.
   const load = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
         const listed: ListedRepository[] = [];
         let githubAccess: GitHubAccess | null = null;
         if (connected.github) {
            const listing = await loadGitHubRepositories();
            githubAccess = listing.access;
            for (const repository of listing.repositories) {
               listed.push({ ...repository, provider: 'github' });
            }
         }
         if (connected.gitlab) {
            const listing = await loadGitLabRepositories();
            for (const repository of listing.repositories) {
               listed.push({ ...repository, provider: 'gitlab' });
            }
         }
         setRepositories(listed);
         setAccess(githubAccess);
      } catch (cause) {
         // An empty list and a list that failed to load look identical, and
         // the fixes are opposite — so the reason is shown, not hidden.
         setError(
            cause instanceof BerryApiError ? cause.message : 'Repositories could not be loaded.'
         );
      } finally {
         setLoading(false);
         setLoaded(true);
      }
   }, [connected.github, connected.gitlab]);

   useEffect(() => {
      if (open && repositories.length === 0 && !loading && !error) void load();
      // Only the opening should trigger a load; a failed load is retried by hand.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [open]);

   // Idle: the first fifty. Searching: every loaded repository that matches,
   // so a name past the idle window is still reachable by typing.
   const visibleRepositories = useMemo(() => {
      const needle = query.trim().toLowerCase();
      if (needle === '') return repositories.slice(0, IDLE_LIST_LIMIT);
      return repositories.filter((repository) =>
         repository.fullName.toLowerCase().includes(needle)
      );
   }, [repositories, query]);

   const choose = useCallback(
      (choice: RepositoryChoice | null) => {
         setOpen(false);
         setCreating(false);
         setQuery('');
         onSelect(choice);
      },
      [onSelect]
   );

   const created = useCallback(
      (repository: GitHubRepository, provider: ScmProvider) => {
         setRepositories((current) => [{ ...repository, provider }, ...current]);
         choose({ provider, fullName: repository.fullName });
      },
      [choose]
   );

   const createProviders = useMemo(() => {
      const providers: ScmProvider[] = [];
      if (connected.github) providers.push('github');
      if (connected.gitlab) providers.push('gitlab');
      return providers;
   }, [connected.github, connected.gitlab]);

   // Nothing to link until an SCM is connected: the button would only open a
   // picker the server refuses. Stay hidden until that is known so the row
   // does not flash in.
   if (!connected.ready || (!connected.github && !connected.gitlab)) return null;

   // `modal`: the picker also opens inside the create-project dialog, whose
   // scroll lock stops wheel events reaching anything outside it, this
   // popover's list included, which then would not scroll. A modal popover
   // carries its own lock and scrolls on its own.
   return (
      <Popover
         open={open}
         onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery('');
         }}
         modal
      >
         <PopoverTrigger asChild>
            <Button
               variant={variant}
               size={size}
               className={cn(
                  'justify-start',
                  size === 'xxs' || size === 'xs' ? 'gap-1' : 'gap-2',
                  className
               )}
               disabled={disabled}
            >
               {size === 'xxs' || size === 'xs' ? (
                  pending ? (
                     <Loader2 className="size-3 shrink-0 animate-spin" />
                  ) : (
                     <ScmMark
                        provider={
                           value
                              ? activeProvider
                              : connected.gitlab && !connected.github
                                ? 'gitlab'
                                : 'github'
                        }
                        className="size-3 shrink-0 text-muted-foreground"
                     />
                  )
               ) : (
                  <PickerRowIcon>
                     {pending ? (
                        <Loader2 className="size-4 animate-spin" />
                     ) : (
                        <ScmMark
                           provider={
                              value
                                 ? activeProvider
                                 : connected.gitlab && !connected.github
                                   ? 'gitlab'
                                   : 'github'
                           }
                           className="size-4 text-muted-foreground"
                        />
                     )}
                  </PickerRowIcon>
               )}
               <span className={value ? 'truncate' : 'truncate text-muted-foreground'}>
                  {value ?? placeholder}
               </span>
            </Button>
         </PopoverTrigger>

         <PopoverContent className="w-72 p-0" align="start" side={side}>
            {creating ? (
               <NewRepositoryForm
                  providers={createProviders}
                  onCreated={created}
                  onCancel={() => setCreating(false)}
                  onLinkExisting={(choice) => choose(choice)}
               />
            ) : (
               <Command shouldFilter={false}>
                  <CommandInput
                     placeholder="Search repositories…"
                     value={query}
                     onValueChange={setQuery}
                     trailing={
                        loaded && !loading ? (
                           <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-6 shrink-0 text-muted-foreground"
                              aria-label="Reload repositories"
                              title="Reload repositories"
                              onClick={() => void load()}
                           >
                              <RefreshCw className="size-3.5" />
                           </Button>
                        ) : null
                     }
                  />
                  <CommandList>
                     {loading ? (
                        <div className="flex items-center gap-2 px-3 py-4 text-muted-foreground">
                           <Loader2 className="size-4 animate-spin" /> Loading…
                        </div>
                     ) : error ? (
                        <div className="px-3 py-4 text-destructive">{error}</div>
                     ) : (
                        <>
                           <CommandEmpty>No repository found.</CommandEmpty>
                           <CommandGroup>
                              {createProviders.length > 0 && query.trim() === '' ? (
                                 <CommandItem
                                    value="new repository"
                                    onSelect={() => setCreating(true)}
                                 >
                                    <Plus className="size-4" /> New repository…
                                 </CommandItem>
                              ) : null}
                              {value && query.trim() === '' ? (
                                 <CommandItem onSelect={() => choose(null)}>
                                    <X className="size-4" /> Unlink
                                 </CommandItem>
                              ) : null}
                              {visibleRepositories.map((repository) => (
                                 <CommandItem
                                    key={`${repository.provider}:${repository.id}`}
                                    value={`${repository.provider} ${repository.fullName}`}
                                    onSelect={() =>
                                       choose({
                                          provider: repository.provider,
                                          fullName: repository.fullName,
                                       })
                                    }
                                 >
                                    <ScmMark
                                       provider={repository.provider}
                                       className="size-4 shrink-0"
                                    />
                                    <span className="truncate">{repository.fullName}</span>
                                    {value === repository.fullName &&
                                    activeProvider === repository.provider ? (
                                       <Check className="text-(--primary) ml-auto size-4" />
                                    ) : null}
                                 </CommandItem>
                              ))}
                           </CommandGroup>
                        </>
                     )}
                  </CommandList>
                  {/* Without an installation a user token reads only public
                   repositories, which looks like a broken picker rather than a
                   missing install. That is the one case worth a footer; once the
                   app is installed the list speaks for itself. A list from the
                   person's GitHub sign-in is not that case: sign-in asks for
                   `repo`, so it already includes their private repositories. */}
                  {connected.github &&
                  access &&
                  !access.installed &&
                  access.source !== 'sign-in' &&
                  access.source !== 'connection' ? (
                     <div className="border-t px-3 py-2 text-muted-foreground">
                        Only public repositories are visible.
                        {access.installUrl ? (
                           <>
                              {' '}
                              <a
                                 href={access.installUrl}
                                 target="_blank"
                                 rel="noreferrer"
                                 className="text-foreground underline underline-offset-2"
                              >
                                 Install the app
                              </a>
                              .
                           </>
                        ) : null}
                     </div>
                  ) : null}
                  {connected.github && access && access.installed && access.canPush === false ? (
                     <div className="border-t px-3 py-2 text-muted-foreground">
                        Read-only access: runs can clone but not push.{' '}
                        {access.manageUrl ? (
                           <a
                              href={access.manageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-foreground underline underline-offset-2"
                           >
                              Grant write access
                           </a>
                        ) : null}
                        .
                     </div>
                  ) : null}
               </Command>
            )}
         </PopoverContent>
      </Popover>
   );
}

/**
 * Makes a repository on the chosen source and hands it back to the picker.
 *
 * When more than one SCM is connected, Source picks which host creates it.
 * Owners are the accounts that host says this credential may create under.
 */
function NewRepositoryForm({
   providers,
   onCreated,
   onCancel,
   onLinkExisting,
}: {
   providers: ScmProvider[];
   onCreated: (repository: GitHubRepository, provider: ScmProvider) => void;
   onCancel: () => void;
   /** The name is taken: link that repository instead of making one. */
   onLinkExisting: (choice: RepositoryChoice) => void;
}) {
   const [provider, setProvider] = useState<ScmProvider>(providers[0] ?? 'github');
   const [name, setName] = useState('');
   const [owners, setOwners] = useState<RepositoryOwner[] | null>(null);
   const [ownersError, setOwnersError] = useState<string | null>(null);
   const [choice, setChoice] = useState('');
   const owner = choice;
   const [isPrivate, setIsPrivate] = useState(true);
   const [pending, setPending] = useState(false);
   const [error, setError] = useState<string | null>(null);
   // Set when the host says the name is taken: the one refusal with a way out
   // other than retyping, so it gets its own message and a button.
   const [exists, setExists] = useState<string | null>(null);
   const valid = /^[A-Za-z0-9._-]{1,100}$/.test(name.trim()) && owner !== '';
   const hostLabel = provider === 'gitlab' ? 'GitLab' : 'GitHub';

   useEffect(() => {
      if (!providers.includes(provider) && providers[0]) setProvider(providers[0]);
   }, [providers, provider]);

   useEffect(() => {
      let cancelled = false;
      setOwners(null);
      setOwnersError(null);
      setChoice('');
      setExists(null);
      const load = provider === 'gitlab' ? loadGitLabRepositoryOwners() : loadRepositoryOwners();
      load
         .then((loaded) => {
            if (cancelled) return;
            setOwners(loaded);
            setChoice(loaded[0]?.login ?? '');
         })
         .catch((cause: unknown) => {
            if (cancelled) return;
            setOwners([]);
            setOwnersError(
               cause instanceof BerryApiError
                  ? cause.message
                  : `Your ${hostLabel} accounts could not be read.`
            );
         });
      return () => {
         cancelled = true;
      };
   }, [provider, hostLabel]);

   const submit = async () => {
      if (!valid || pending) return;
      setPending(true);
      setError(null);
      setExists(null);
      try {
         const created =
            provider === 'gitlab'
               ? await createGitLabRepository({
                    name: name.trim(),
                    owner: owner.trim() || null,
                    private: isPrivate,
                 })
               : await createGitHubRepository({
                    name: name.trim(),
                    owner: owner.trim() || null,
                    private: isPrivate,
                 });
         onCreated(created, provider);
      } catch (cause) {
         if (cause instanceof BerryApiError && cause.code === 'REPOSITORY_EXISTS') {
            setExists(`${owner}/${name.trim()}`);
            return;
         }
         setError(
            cause instanceof BerryApiError ? cause.message : 'The repository could not be created.'
         );
      } finally {
         setPending(false);
      }
   };

   return (
      // Not a <form>: the picker opens inside the create-project dialog, which
      // is a form itself, and a nested form's submit reaches the outer one — the
      // dialog then validated the project name instead of creating the
      // repository. Enter on the name field and the button call submit directly.
      <div className="flex flex-col gap-3 p-3">
         <div className="font-medium">New repository</div>
         {providers.length > 1 ? (
            <div className="flex flex-col gap-1.5">
               <Label htmlFor="new-repository-provider">Source</Label>
               <Select value={provider} onValueChange={(next) => setProvider(next as ScmProvider)}>
                  <SelectTrigger id="new-repository-provider" className="w-full">
                     <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                     {providers.map((candidate) => (
                        <SelectItem key={candidate} value={candidate}>
                           {candidate === 'gitlab' ? 'GitLab' : 'GitHub'}
                        </SelectItem>
                     ))}
                  </SelectContent>
               </Select>
            </div>
         ) : null}
         <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-repository-owner">Owner</Label>
            {owners === null ? (
               <div className="flex h-9 items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Reading your accounts…
               </div>
            ) : owners.length === 0 ? (
               <p className="text-muted-foreground">
                  {ownersError ??
                     `${hostLabel} lists no account you may create a repository under.`}
               </p>
            ) : (
               <Select value={choice} onValueChange={setChoice}>
                  <SelectTrigger id="new-repository-owner" className="w-full">
                     <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                     {owners.map((candidate) => (
                        <SelectItem key={candidate.login} value={candidate.login}>
                           {candidate.login}
                           {candidate.type === 'user' ? ' (you)' : ''}
                        </SelectItem>
                     ))}
                  </SelectContent>
               </Select>
            )}
         </div>
         <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-repository-name">Name</Label>
            <Input
               id="new-repository-name"
               value={name}
               onChange={(event) => {
                  setName(event.target.value);
                  setExists(null);
               }}
               placeholder="my-project"
               onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                     event.preventDefault();
                     void submit();
                  }
               }}
               autoFocus
               autoComplete="off"
            />
         </div>
         <div className="flex items-center justify-between gap-3">
            <Label htmlFor="new-repository-private" className="font-normal">
               Private
            </Label>
            <Switch
               id="new-repository-private"
               checked={isPrivate}
               onCheckedChange={setIsPrivate}
            />
         </div>
         {exists ? (
            <div className="flex flex-col gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-2.5">
               <p>
                  <span className="font-medium">{exists}</span> already exists on {hostLabel}.
                  Choose another name, or link it as it is.
               </p>
               <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => onLinkExisting({ provider, fullName: exists })}
               >
                  Link {exists}
               </Button>
            </div>
         ) : null}
         {error ? <p className="text-destructive">{error}</p> : null}
         <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
               Back
            </Button>
            <Button
               type="button"
               size="sm"
               disabled={!valid || pending}
               onClick={() => void submit()}
            >
               {pending ? <Loader2 className="size-4 animate-spin" /> : null}
               Create
            </Button>
         </div>
      </div>
   );
}

/**
 * The project-bound wrapper: choosing a repository saves it on the project.
 *
 * The local change is rolled back if the request fails, because a repository
 * that looks linked and is not is the failure this whole path exists to avoid.
 */
export function RepositorySelector({ project }: { project: Project }) {
   const updateProject = useProjectsStore((state) => state.updateProject);
   const [saving, setSaving] = useState(false);
   const value = project.gitlabRepo ?? project.githubRepo;
   const valueProvider: ScmProvider | undefined = project.gitlabRepo
      ? 'gitlab'
      : project.githubRepo
        ? 'github'
        : undefined;

   const save = useCallback(
      async (choice: RepositoryChoice | null) => {
         const previousGithub = project.githubRepo;
         const previousGitlab = project.gitlabRepo;
         setSaving(true);
         updateProject(project.id, {
            githubRepo: choice?.provider === 'github' ? choice.fullName : undefined,
            gitlabRepo: choice?.provider === 'gitlab' ? choice.fullName : undefined,
         });
         try {
            await setProjectRepository(project.id, choice);
            toast.success(choice ? `Linked to ${choice.fullName}` : 'Repository unlinked');
         } catch (cause) {
            updateProject(project.id, {
               githubRepo: previousGithub,
               gitlabRepo: previousGitlab,
            });
            toast.error(
               cause instanceof BerryApiError
                  ? cause.message
                  : 'That repository could not be saved.'
            );
         } finally {
            setSaving(false);
         }
      },
      [project.id, project.githubRepo, project.gitlabRepo, updateProject]
   );

   return (
      <RepositoryPicker
         value={value}
         valueProvider={valueProvider}
         onSelect={(choice) => void save(choice)}
         disabled={saving}
         pending={saving}
      />
   );
}
