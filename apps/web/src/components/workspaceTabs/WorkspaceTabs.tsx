import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ContextMenuItem,
  type ScopedThreadRef,
  TAB_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import type { ProviderInstanceId } from "@t3tools/contracts";
import {
  FileCodeIcon,
  MessageSquareIcon,
  NotebookTextIcon,
  PinIcon,
  PlusIcon,
  SettingsIcon,
  SquarePenIcon,
  SquareTerminalIcon,
  XIcon,
} from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import {
  type DragEvent,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isElectron } from "../../env";
import { readLocalApi } from "../../localApi";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { readNewThreadProjectRef } from "../../shortcuts/chatRouteCommands";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useClientSettings, usePrimarySettings } from "../../hooks/useSettings";
import { resolveThreadActionProjectRef } from "../../lib/chatThreadActions";
import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { resolveAppModelSelectionForInstance } from "../../modelSelection";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { cn } from "../../lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useClosedViewStore } from "../../closedViewStore";
import { openCommandPalette } from "../../commandPaletteBus";
import { registerCommands } from "../../shortcuts/dispatcher";
import { readEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { ThreadRenameInput } from "../sidebar/SidebarThreadRow";
import { toastManager } from "../ui/toast";
import { readThreadShell, useThreadShell } from "../../state/entities";
import { primaryServerProvidersAtom } from "../../state/server";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { useShowThreadInMain } from "./WorkspaceSplit";
import { useNewTerminalTab } from "./WorkspaceSurfaceView";
import {
  draftTabKey,
  neighborTabKey,
  parseWorkspaceTab,
  TAB_GROUP_COLORS,
  type TabGroupColor,
  useWorkspaceTabsStore,
  type WorkspaceSplitDirection,
  type WorkspaceTab,
  type WorkspaceTabGroup,
} from "./workspaceTabsStore";

const TAB_CLASS =
  "group/tab relative flex h-7.5 min-w-0 max-w-56 flex-1 items-center overflow-hidden rounded-md text-sm [-webkit-app-region:no-drag]";
const TAB_BODY_CLASS =
  "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pr-7 pl-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
const TAB_DRAG_TYPE = "application/x-xen-workspace-tab";
const ACTIVE_TAB_CLASS = "bg-foreground/10 text-foreground";
const TAB_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
const IDLE_TAB_CLASS =
  "bg-foreground/4 text-foreground opacity-65 hover:bg-foreground/7 hover:opacity-100";
// Full class strings so Tailwind sees them: the label's dot and the tinted box around the group.
const GROUP_COLOR_CLASS: Record<TabGroupColor, { dot: string; box: string }> = {
  grey: { dot: "bg-zinc-500", box: "bg-zinc-500/10 ring-zinc-500/30" },
  blue: { dot: "bg-blue-500", box: "bg-blue-500/10 ring-blue-500/30" },
  red: { dot: "bg-red-500", box: "bg-red-500/10 ring-red-500/30" },
  yellow: { dot: "bg-amber-500", box: "bg-amber-500/10 ring-amber-500/30" },
  green: { dot: "bg-green-500", box: "bg-green-500/10 ring-green-500/30" },
  pink: { dot: "bg-pink-500", box: "bg-pink-500/10 ring-pink-500/30" },
  purple: { dot: "bg-violet-500", box: "bg-violet-500/10 ring-violet-500/30" },
  cyan: { dot: "bg-cyan-500", box: "bg-cyan-500/10 ring-cyan-500/30" },
  orange: { dot: "bg-orange-500", box: "bg-orange-500/10 ring-orange-500/30" },
};

function groupLabel(group: WorkspaceTabGroup): string {
  return group.title || `${group.color[0]!.toUpperCase()}${group.color.slice(1)} group`;
}

type TabDragHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  "onDragStart" | "onDragEnter" | "onDragOver" | "onDragEnd" | "onDrop"
>;

function Tab({
  tabKey,
  icon,
  label,
  active,
  onSelect,
  onClose,
  onContextMenu,
  onDoubleClick,
  drag,
  titleInput,
  pinned,
  inGroup,
  folded,
  animationMs,
}: {
  tabKey: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu?: ((event: MouseEvent) => void) | undefined;
  onDoubleClick?: (() => void) | undefined;
  drag?: TabDragHandlers | undefined;
  /** Shown in place of the label while the tab is being renamed. */
  titleInput?: ReactNode;
  /** A pinned tab shows a pin where the close button would be; middle-click and the menu still close it. */
  pinned?: boolean | undefined;
  /** Sits inside a group's box, a little shorter so the box keeps the bar's height. */
  inGroup?: boolean | undefined;
  /** Hidden inside a collapsed group; it folds to nothing rather than unmounting, so it can unfold. */
  folded?: boolean | undefined;
  animationMs: number;
}) {
  // The close button is a sibling, not a child, so assistive technology can reach it.
  return (
    <div
      data-tab-key={tabKey}
      data-flip-key={tabKey}
      draggable={!titleInput && !folded}
      inert={folded}
      {...drag}
      style={{ transitionDuration: `${animationMs}ms` }}
      className={cn(
        TAB_CLASS,
        "transition-[max-width,margin-right] ease-out",
        active ? ACTIVE_TAB_CLASS : IDLE_TAB_CLASS,
        inGroup && "h-6.5",
        folded && "-mr-0.5 max-w-0",
      )}
    >
      {titleInput ? (
        <div className={TAB_BODY_CLASS}>
          {icon}
          {titleInput}
        </div>
      ) : (
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          onClick={onSelect}
          onDoubleClick={onDoubleClick}
          onAuxClick={(event) => {
            if (event.button === 1) onClose();
          }}
          onContextMenu={onContextMenu}
          className={TAB_BODY_CLASS}
        >
          {icon}
          <span className="truncate">{label}</span>
        </button>
      )}
      {pinned ? (
        <PinIcon
          role="img"
          aria-label="Pinned"
          className="pointer-events-none absolute right-2 size-3 text-muted-foreground"
        />
      ) : (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={onClose}
          className={cn(
            "absolute right-1 grid size-5 place-items-center rounded-sm text-muted-foreground outline-hidden group-hover/tab:opacity-100 group-focus-within/tab:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            active ? "opacity-100" : "opacity-0",
          )}
        >
          <XIcon aria-hidden className="size-3" />
        </button>
      )}
    </div>
  );
}

type TabProps = {
  tabKey: string;
  inGroup?: boolean | undefined;
  folded?: boolean | undefined;
  animationMs: number;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu?: ((event: MouseEvent) => void) | undefined;
  drag?: TabDragHandlers | undefined;
  pinned?: boolean | undefined;
};

type ThreadRename = {
  renaming: boolean;
  onStartRename: () => void;
  onCommitRename: (title: string, originalTitle: string) => void;
  onCancelRename: () => void;
};

/** Whether a tab still renders; a gone thread or discarded draft keeps its key but shows nothing. */
function isTabShown(tab: WorkspaceTab): boolean {
  if (tab.kind === "thread") return readThreadShell(tab.threadRef) !== null;
  if (tab.kind === "draft") {
    return useComposerDraftStore.getState().getDraftSession(DraftId.make(tab.draftId)) !== null;
  }
  return true;
}

/**
 * Records where each tab, group, and the new-tab button sits, to slide them from after a change.
 * A change that renders nothing leaves the record unused, so it lapses after a frame.
 */
function rememberTabPositions(
  nav: HTMLElement | null,
  positionsRef: { current: Map<string, number> | null },
): void {
  if (!nav) return;
  const positions = new Map(
    Array.from(nav.querySelectorAll<HTMLElement>("[data-flip-key]"), (element) => [
      element.dataset.flipKey!,
      element.getBoundingClientRect().left,
    ]),
  );
  positionsRef.current = positions;
  requestAnimationFrame(() => {
    if (positionsRef.current === positions) positionsRef.current = null;
  });
}

/** The tab key a file or terminal tab's thread is routed under: its thread, or its draft. */
function surfaceOwnerKey(threadRef: ScopedThreadRef): string {
  const draftId = useComposerDraftStore.getState().getDraftIdByRef(threadRef);
  return draftId && !readThreadShell(threadRef) ? draftTabKey(draftId) : scopedThreadKey(threadRef);
}

function ThreadTab({
  threadRef,
  rename,
  ...props
}: TabProps & { threadRef: ScopedThreadRef; rename: ThreadRename }) {
  const thread = useThreadShell(threadRef);
  // Null until edited, so a rename started from the tab menu begins at the live title.
  const [title, setTitle] = useState<string | null>(null);
  const providers = useAtomValue(primaryServerProvidersAtom);
  if (!thread) return null;
  const provider = providers.find((entry) => entry.instanceId === thread.providerInstanceId);
  const icon = provider ? (
    <ProviderInstanceIcon
      driverKind={provider.driver}
      displayName={provider.displayName ?? provider.driver}
      accentColor={provider.accentColor}
      size="compact"
      className="shrink-0"
    />
  ) : (
    <MessageSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
  );
  return (
    <Tab
      icon={icon}
      label={thread.title}
      onDoubleClick={rename.onStartRename}
      titleInput={
        rename.renaming ? (
          <ThreadRenameInput
            title={title ?? thread.title}
            onTitleChange={setTitle}
            onCommit={() => {
              setTitle(null);
              rename.onCommitRename(title ?? thread.title, thread.title);
            }}
            onCancel={() => {
              setTitle(null);
              rename.onCancelRename();
            }}
          />
        ) : null
      }
      {...props}
    />
  );
}

function DraftTab({ draftId, ...props }: TabProps & { draftId: string }) {
  const exists = useComposerDraftStore(
    (store) => store.getDraftSession(DraftId.make(draftId)) !== null,
  );
  if (!exists) return null;
  return (
    <Tab
      icon={<SquarePenIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      label="New thread"
      {...props}
    />
  );
}

function WorkspaceTabButton({
  tab,
  rename,
  ...props
}: TabProps & { tab: WorkspaceTab; rename: ThreadRename }) {
  switch (tab.kind) {
    case "thread":
      return <ThreadTab threadRef={tab.threadRef} rename={rename} {...props} />;
    case "draft":
      return <DraftTab draftId={tab.draftId} {...props} />;
    case "file":
      return (
        <Tab
          icon={<FileCodeIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
          label={tab.path.split("/").pop() ?? tab.path}
          {...props}
        />
      );
    case "terminal":
      return (
        <Tab
          icon={
            <SquareTerminalIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          }
          label="Terminal"
          {...props}
        />
      );
  }
}

function TabGroupLabel({
  group,
  tabCount,
  renaming,
  onToggle,
  onContextMenu,
  onCommitRename,
  onCancelRename,
}: {
  group: WorkspaceTabGroup;
  tabCount: number;
  renaming: boolean;
  onToggle: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
}) {
  const [title, setTitle] = useState<string | null>(null);
  const dot = (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", GROUP_COLOR_CLASS[group.color].dot)}
    />
  );
  if (renaming) {
    return (
      <div className="flex h-6.5 w-36 shrink-0 items-center gap-1.5 px-2 [-webkit-app-region:no-drag]">
        {dot}
        <ThreadRenameInput
          title={title ?? group.title}
          ariaLabel="Group name"
          onTitleChange={setTitle}
          onCommit={() => {
            setTitle(null);
            onCommitRename(title ?? group.title);
          }}
          onCancel={() => {
            setTitle(null);
            onCancelRename();
          }}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={!group.collapsed}
      aria-label={`${groupLabel(group)}, ${tabCount} ${tabCount === 1 ? "tab" : "tabs"}`}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      className="flex h-6.5 max-w-36 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground outline-hidden [-webkit-app-region:no-drag] hover:bg-foreground/7 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {dot}
      {group.title ? <span className="truncate">{group.title}</span> : null}
      {group.collapsed ? (
        <span className="text-xs text-muted-foreground tabular-nums">{tabCount}</span>
      ) : null}
    </button>
  );
}

export function WorkspaceTabs() {
  const navigate = useNavigate();
  const routeTarget = useThreadRouteTarget();
  const keys = useWorkspaceTabsStore((state) => state.keys);
  const surfaceKey = useWorkspaceTabsStore((state) => state.surfaceKey);
  const openTab = useWorkspaceTabsStore((state) => state.open);
  const closeTab = useWorkspaceTabsStore((state) => state.close);
  const showSurface = useWorkspaceTabsStore((state) => state.showSurface);
  const hideSurface = useWorkspaceTabsStore((state) => state.hideSurface);
  const splitKey = useWorkspaceTabsStore((state) => state.split?.key ?? null);
  const openSplit = useWorkspaceTabsStore((state) => state.openSplit);
  const closeSplit = useWorkspaceTabsStore((state) => state.closeSplit);
  const newThreadContext = useHandleNewThread();
  const newTerminalTab = useNewTerminalTab();
  const replaceTab = useWorkspaceTabsStore((state) => state.replace);
  const moveTab = useWorkspaceTabsStore((state) => state.move);
  const pinnedKeys = useWorkspaceTabsStore((state) => state.pinned);
  const terminalActions = useThreadTerminalActions(null);
  const togglePin = useWorkspaceTabsStore((state) => state.togglePin);
  const groups = useWorkspaceTabsStore((state) => state.groups);
  const tabGroup = useWorkspaceTabsStore((state) => state.tabGroup);
  const createGroup = useWorkspaceTabsStore((state) => state.createGroup);
  const addToGroup = useWorkspaceTabsStore((state) => state.addToGroup);
  const removeFromGroup = useWorkspaceTabsStore((state) => state.removeFromGroup);
  const updateGroup = useWorkspaceTabsStore((state) => state.updateGroup);
  const ungroup = useWorkspaceTabsStore((state) => state.ungroup);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  // Where each tab and group label sat before a reorder, for sliding them to their new places.
  const flipFromRef = useRef<Map<string, number> | null>(null);
  const draggingKeyRef = useRef<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  // Not usePanelAnimationSettings: it pauses on every route change, and opening a tab is one.
  const tabAnimationMs = useClientSettings((settings) => settings.panelAnimationDurationMs);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const tabAnimation = { active: tabAnimationMs > 0 && !reducedMotion, durationMs: tabAnimationMs };
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const routedDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const routedKey =
    routeTarget?.kind === "server"
      ? scopedThreadKey(routeTarget.threadRef)
      : routedDraftId
        ? draftTabKey(routedDraftId)
        : null;
  const activeKey = surfaceKey ?? routedKey;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records the routed thread or draft in the persisted tab store, and leaves a file or terminal tab once another one is routed
  useEffect(() => {
    if (!routedKey) return;
    const { surfaceKey: shown, keys: openKeys } = useWorkspaceTabsStore.getState();
    const drafts = useComposerDraftStore.getState();
    // A sent draft's tab becomes its thread's tab; tabs of discarded drafts go away.
    let promotedFrom: string | null = null;
    for (const key of openKeys) {
      const tab = parseWorkspaceTab(key);
      if (tab?.kind !== "draft" || key === routedKey) continue;
      const draftId = DraftId.make(tab.draftId);
      const session = drafts.getDraftSession(draftId);
      const sentTo = session?.promotedTo ?? drafts.getPromotedDraftRedirect(draftId);
      if (sentTo && scopedThreadKey(sentTo) === routedKey) promotedFrom = key;
      else if (!session) closeTab(key);
    }
    if (promotedFrom || !openKeys.includes(routedKey)) {
      rememberTabPositions(navRef.current, flipFromRef);
    }
    if (promotedFrom) {
      // The sent thread's tab takes the draft's spot instead of appearing as a new tab.
      const draftSpot = flipFromRef.current?.get(promotedFrom);
      if (draftSpot !== undefined) flipFromRef.current?.set(routedKey, draftSpot);
      replaceTab(promotedFrom, routedKey);
    } else openTab(routedKey);
    const surface = shown ? parseWorkspaceTab(shown) : null;
    if (surface && surface.kind !== "draft" && surfaceOwnerKey(surface.threadRef) !== routedKey) {
      hideSurface();
    }
  }, [routedKey, openTab, closeTab, replaceTab, hideSurface]);

  // Tab motion runs on transform and opacity only, so it stays smooth while the app renders the
  // thread a tab switch opens. Each change records positions first; the layout effect slides from there.
  const rememberPositions = () => rememberTabPositions(navRef.current, flipFromRef);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- slides tabs from their recorded spots to their new ones before they first paint; runs after every render and acts only when a change left positions behind
  useLayoutEffect(() => {
    const from = flipFromRef.current;
    flipFromRef.current = null;
    const nav = navRef.current;
    if (!from || !nav || !tabAnimation.active) return;
    const elements = Array.from(nav.querySelectorAll<HTMLElement>("[data-flip-key]"));
    for (const element of elements)
      for (const animation of element.getAnimations()) animation.cancel();
    const deltas = new Map<HTMLElement, number | null>(
      elements.map((element) => {
        const before = from.get(element.dataset.flipKey!);
        return [
          element,
          before === undefined ? null : before - element.getBoundingClientRect().left,
        ];
      }),
    );
    for (const [element, delta] of deltas) {
      const parent = element.parentElement?.closest<HTMLElement>("[data-flip-key]");
      const parentDelta = parent ? deltas.get(parent) : 0;
      if (delta === null) {
        // A new tab inside a new group arrives with its group.
        if (parentDelta !== null) {
          element.animate(
            [
              { opacity: 0, transform: "scale(0.9)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: tabAnimation.durationMs, easing: TAB_EASE },
          );
        }
        continue;
      }
      // A tab inside a group moves with its group's box; slide only the rest.
      const own = delta - (parentDelta ?? 0);
      if (Math.abs(own) < 1) continue;
      element.animate([{ transform: `translateX(${own}px)` }, { transform: "none" }], {
        duration: tabAnimation.durationMs,
        easing: TAB_EASE,
      });
    }
  });

  /** Leaves a fading copy of a closing tab, since the tab itself leaves the DOM at once. */
  const fadeOutTab = (key: string) => {
    const nav = navRef.current;
    if (!tabAnimation.active || !nav) return;
    const element = nav.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(key)}"]`);
    if (!element || element.offsetWidth === 0) return;
    const navRect = nav.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const ghost = element.cloneNode(true) as HTMLElement;
    delete ghost.dataset.tabKey;
    delete ghost.dataset.flipKey;
    ghost.inert = true;
    Object.assign(ghost.style, {
      position: "absolute",
      left: `${rect.left - navRect.left + nav.scrollLeft}px`,
      top: `${rect.top - navRect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      pointerEvents: "none",
    });
    nav.append(ghost);
    const remove = () => ghost.remove();
    ghost
      .animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "scale(0.9)" },
        ],
        {
          duration: Math.round(tabAnimation.durationMs * 0.75),
          easing: TAB_EASE,
          fill: "forwards",
        },
      )
      .finished.then(remove, remove);
  };

  const showThread = useShowThreadInMain();
  const splitShown = splitKey !== null && splitKey !== routedKey;
  const groupById = new Map(groups.map((group) => [group.id, group]));
  // A collapsed group still shows the tab you are on, so the active tab never disappears.
  const isFolded = (key: string) =>
    groupById.get(tabGroup[key] ?? "")?.collapsed === true &&
    key !== activeKey &&
    !(splitShown && key === splitKey);
  // Runs of adjacent tabs: ungrouped ones, or one group's tabs (the store keeps a group's tabs together).
  const segments: Array<{ group: WorkspaceTabGroup | null; keys: string[] }> = [];
  for (const key of keys) {
    const group = groupById.get(tabGroup[key] ?? "") ?? null;
    const last = segments.at(-1);
    if (last && last.group === group) last.keys.push(key);
    else segments.push({ group, keys: [key] });
  }

  const showDraft = (draftId: string) =>
    void navigate({ to: "/draft/$draftId", params: { draftId: DraftId.make(draftId) } });

  const select = (key: string, tab: WorkspaceTab) => {
    if (tab.kind === "thread") {
      hideSurface();
      showThread(tab.threadRef);
      return;
    }
    if (tab.kind === "draft") {
      hideSurface();
      showDraft(tab.draftId);
      return;
    }
    showSurface(key);
    const ownerKey = surfaceOwnerKey(tab.threadRef);
    if (ownerKey === routedKey) return;
    if (readThreadShell(tab.threadRef)) showThread(tab.threadRef);
    else {
      const draftId = useComposerDraftStore.getState().getDraftIdByRef(tab.threadRef);
      if (draftId) showDraft(draftId);
    }
  };

  const close = (key: string) => closeTabs([key]);

  const closeTabs = (keysToClose: ReadonlyArray<string>) => {
    rememberPositions();
    for (const key of keysToClose) fadeOutTab(key);
    if (activeKey && keysToClose.includes(activeKey)) {
      const key = activeKey;
      const shownKeys = keys.filter((open) => {
        const openTab = parseWorkspaceTab(open);
        return (
          open === key || (openTab !== null && !keysToClose.includes(open) && isTabShown(openTab))
        );
      });
      // The split pane's thread takes over the main pane when the main one closes.
      const next =
        (splitShown && key === routedKey && splitKey && !keysToClose.includes(splitKey)
          ? splitKey
          : null) ??
        neighborTabKey(shownKeys, key, {
          preferPrevious: parseWorkspaceTab(key)?.kind === "draft",
        });
      const nextTab = next ? parseWorkspaceTab(next) : null;
      if (next && nextTab) select(next, nextTab);
      else {
        hideSurface();
        if (key === routedKey) void navigate({ to: "/" });
      }
    }
    for (const key of keysToClose) {
      const tab = parseWorkspaceTab(key);
      // Thread and file tabs come back with the reopen shortcut. Closing a terminal tab ends its shell.
      if (tab?.kind === "terminal")
        terminalActions.closeTerminalSession(tab.terminalId, tab.threadRef);
      else if (tab?.kind === "thread" || tab?.kind === "file") {
        useClosedViewStore
          .getState()
          .remember({ kind: "workspace-tab", threadRef: tab.threadRef, key });
      }
      closeTab(key);
    }
  };

  const runTabShortcut = useEffectEvent((target: "next" | "previous" | "close" | number) => {
    if (target === "close") {
      if (!activeKey) return false;
      close(activeKey);
      return;
    }
    const shownKeys = keys.filter((key) => !isFolded(key));
    const index = activeKey ? shownKeys.indexOf(activeKey) : -1;
    const nextKey =
      target === "next"
        ? shownKeys[(index + 1) % shownKeys.length]
        : target === "previous"
          ? shownKeys[(index - 1 + shownKeys.length) % shownKeys.length]
          : // The ninth jump goes to the last tab, as in browsers.
            target === 9
            ? shownKeys.at(-1)
            : shownKeys[target - 1];
    const nextTab = nextKey ? parseWorkspaceTab(nextKey) : null;
    if (!nextKey || !nextTab) return false;
    select(nextKey, nextTab);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the tab bar's keyboard shortcuts with the global command dispatcher
  useEffect(
    () =>
      registerCommands({
        "tab.next": () => runTabShortcut("next"),
        "tab.previous": () => runTabShortcut("previous"),
        ...Object.fromEntries(
          TAB_JUMP_KEYBINDING_COMMANDS.map((command, index) => [
            command,
            () => runTabShortcut(index + 1),
          ]),
        ),
        // The chat closes its right panel tab first and passes the key on when it has none.
        "rightPanel.close": (event) => (event.repeat ? undefined : runTabShortcut("close")),
      }),
    [],
  );

  const canRename = (threadRef: ScopedThreadRef) =>
    readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);

  const commitRename = (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
    setRenamingKey(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
      return;
    }
    if (trimmed === originalTitle || !canRename(threadRef)) return;
    void updateThreadMetadata({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, title: trimmed },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    });
  };

  // Tabs reorder live as one is dragged across them, like browser tabs.
  const dragHandlers = (key: string): TabDragHandlers => ({
    onDragStart: (event: DragEvent) => {
      draggingKeyRef.current = key;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(TAB_DRAG_TYPE, key);
    },
    onDragEnter: (event: DragEvent) => {
      const dragging = draggingKeyRef.current;
      // A tab still sliding into place passes under the pointer; reacting to it would bounce the drag.
      if (!dragging || dragging === key || event.currentTarget.getAnimations().length > 0) return;
      rememberPositions();
      moveTab(dragging, key);
    },
    onDragOver: (event: DragEvent) => {
      if (draggingKeyRef.current) event.preventDefault();
    },
    onDrop: (event: DragEvent) => {
      if (draggingKeyRef.current) event.preventDefault();
    },
    onDragEnd: () => {
      draggingKeyRef.current = null;
    },
  });

  const showTabMenu = (event: MouseEvent, key: string, tab: WorkspaceTab) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    const inMain = key === routedKey;
    const threadItems: ContextMenuItem<WorkspaceSplitDirection | "rename">[] =
      tab.kind === "thread"
        ? [
            { id: "rename", label: "Rename", disabled: !canRename(tab.threadRef) },
            { id: "right", label: "Split right", disabled: inMain, separatorBefore: true },
            { id: "down", label: "Split down", disabled: inMain },
          ]
        : [];
    const currentGroup = tabGroup[key];
    const otherGroups = groups.filter((group) => group.id !== currentGroup);
    const items: ContextMenuItem<
      | WorkspaceSplitDirection
      | "rename"
      | "pin"
      | "close-split"
      | "close"
      | "new-group"
      | "leave-group"
      | `group:${string}`
    >[] = [
      ...threadItems,
      otherGroups.length > 0
        ? {
            id: "new-group",
            label: "Add tab to group",
            separatorBefore: threadItems.length > 0,
            children: [
              { id: "new-group", label: "New group" },
              ...otherGroups.map((group, index) => ({
                id: `group:${group.id}` as const,
                label: groupLabel(group),
                separatorBefore: index === 0,
              })),
            ],
          }
        : {
            id: "new-group",
            label: "Add tab to new group",
            separatorBefore: threadItems.length > 0,
          },
      ...(currentGroup ? [{ id: "leave-group" as const, label: "Remove from group" }] : []),
      { id: "pin", label: pinnedKeys.includes(key) ? "Unpin tab" : "Pin tab" },
      ...(splitShown ? [{ id: "close-split" as const, label: "Close split" }] : []),
      { id: "close", label: "Close tab", separatorBefore: true },
    ];
    void api.contextMenu.show(items, { x: event.clientX, y: event.clientY }).then((action) => {
      if (action === "rename") setRenamingKey(key);
      else if (action === "new-group") {
        rememberPositions();
        const groupId = createGroup(key);
        if (groupId) setRenamingGroupId(groupId);
      } else if (action === "leave-group") {
        rememberPositions();
        removeFromGroup(key);
      } else if (action?.startsWith("group:")) {
        rememberPositions();
        addToGroup(key, action.slice("group:".length));
      } else if (action === "pin") {
        rememberPositions();
        togglePin(key);
      } else if (action === "right" || action === "down") openSplit(key, action);
      else if (action === "close-split") closeSplit();
      else if (action === "close") close(key);
    });
  };

  const showGroupMenu = (event: MouseEvent, group: WorkspaceTabGroup) => {
    const api = readLocalApi();
    if (!api) return;
    event.preventDefault();
    const items: ContextMenuItem<"rename" | "ungroup" | "close" | `color:${TabGroupColor}`>[] = [
      { id: "rename", label: "Rename group" },
      {
        id: `color:${group.color}`,
        label: "Color",
        children: TAB_GROUP_COLORS.map((color) => ({
          id: `color:${color}` as const,
          label: `${color[0]!.toUpperCase()}${color.slice(1)}`,
          checked: color === group.color,
        })),
      },
      { id: "ungroup", label: "Ungroup", separatorBefore: true },
      { id: "close", label: "Close group", destructive: true },
    ];
    void api.contextMenu.show(items, { x: event.clientX, y: event.clientY }).then((action) => {
      if (action === "rename") setRenamingGroupId(group.id);
      else if (action === "ungroup") ungroup(group.id);
      else if (action === "close") closeTabs(keys.filter((key) => tabGroup[key] === group.id));
      else if (action?.startsWith("color:")) {
        const color = TAB_GROUP_COLORS.find((entry) => `color:${entry}` === action);
        if (color) updateGroup(group.id, { color });
      }
    });
  };

  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom).filter(
    (provider) => provider.enabled && provider.models.length > 0,
  );

  // Like the sidebar button and the shortcut. A provider pick has no palette step,
  // so with several projects and no sidebar scope it starts in the current one.
  const startNewThread = async (instanceId?: ProviderInstanceId) => {
    const contextProjectRef = resolveThreadActionProjectRef({
      activeDraftThread: newThreadContext.activeDraftThread,
      activeThread: newThreadContext.activeThread ?? undefined,
      defaultProjectRef: newThreadContext.defaultProjectRef,
      handleNewThread: newThreadContext.handleNewThread,
    });
    const projectRef =
      readNewThreadProjectRef(contextProjectRef) ?? (instanceId ? contextProjectRef : null);
    if (!projectRef) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    const started = await newThreadContext.handleNewThread(projectRef);
    if (!started || !instanceId) return;
    // Like Orca's agent rows: start on the agent's last-used model, else its default.
    const drafts = useComposerDraftStore.getState();
    const provider = providers.find((entry) => entry.instanceId === instanceId);
    const model = resolveAppModelSelectionForInstance(
      instanceId,
      settings,
      providers,
      drafts.stickyModelSelectionByProvider[instanceId]?.model ??
        (provider?.models.find((entry) => entry.isDefault) ?? provider?.models[0])?.slug,
    );
    if (!model) return;
    drafts.setModelSelection(started.draftId, { instanceId, model }, { explicit: true });
  };

  return (
    <nav
      ref={navRef}
      className={cn(
        // Same height as the fixed sidebar and panel controls, so their icons line up with the tabs.
        "relative hidden h-(--workspace-topbar-height) shrink-0 items-center gap-0.5 overflow-x-auto pr-(--workspace-tabs-end-inset) pl-1.5 md:flex",
        isElectron && "drag-region",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      aria-label="Open tabs"
    >
      {segments.map((segment) => {
        const tabs = segment.keys.map((key) => {
          const tab = parseWorkspaceTab(key);
          if (!tab) return null;
          return (
            <WorkspaceTabButton
              key={key}
              tabKey={key}
              inGroup={segment.group !== null}
              folded={isFolded(key)}
              animationMs={tabAnimation.active ? tabAnimation.durationMs : 0}
              tab={tab}
              active={key === activeKey || (splitShown && key === splitKey)}
              onSelect={() => select(key, tab)}
              onClose={() => close(key)}
              drag={dragHandlers(key)}
              rename={{
                renaming: renamingKey === key,
                onStartRename: () => {
                  if (tab.kind === "thread" && canRename(tab.threadRef)) setRenamingKey(key);
                },
                onCommitRename: (title, originalTitle) => {
                  if (tab.kind === "thread") commitRename(tab.threadRef, title, originalTitle);
                },
                onCancelRename: () => setRenamingKey(null),
              }}
              pinned={pinnedKeys.includes(key)}
              onContextMenu={(event: MouseEvent) => showTabMenu(event, key, tab)}
            />
          );
        });
        const group = segment.group;
        if (!group) return tabs;
        return (
          <div
            key={`group:${group.id}`}
            role="group"
            aria-label={groupLabel(group)}
            data-flip-key={`group:${group.id}`}
            className={cn(
              "flex h-7.5 min-w-0 shrink items-center gap-0.5 rounded-lg p-0.5 ring-1 ring-inset",
              GROUP_COLOR_CLASS[group.color].box,
            )}
          >
            <TabGroupLabel
              group={group}
              tabCount={segment.keys.length}
              renaming={renamingGroupId === group.id}
              onToggle={() => updateGroup(group.id, { collapsed: !group.collapsed })}
              onContextMenu={(event) => showGroupMenu(event, group)}
              onCommitRename={(title) => {
                setRenamingGroupId(null);
                updateGroup(group.id, { title: title.trim() });
              }}
              onCancelRename={() => setRenamingGroupId(null)}
            />
            {tabs}
          </div>
        );
      })}
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              data-flip-key="new-tab"
              aria-label="New tab"
              className="ml-0.5 grid size-7.5 shrink-0 place-items-center rounded-md bg-foreground/4 text-muted-foreground opacity-65 outline-hidden [-webkit-app-region:no-drag] hover:bg-foreground/7 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-popup-open:opacity-100"
            />
          }
        >
          <PlusIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="start" sideOffset={6} className="min-w-60">
          <MenuItem onClick={() => void startNewThread()}>
            <SquarePenIcon />
            New thread
          </MenuItem>
          <MenuItem disabled={!newTerminalTab} onClick={() => newTerminalTab?.()}>
            <SquareTerminalIcon />
            New terminal
          </MenuItem>
          <MenuItem onClick={() => void navigate({ to: "/notes" })}>
            <NotebookTextIcon />
            Notes
          </MenuItem>
          {providers.length > 0 ? <MenuSeparator /> : null}
          {providers.map((provider) => (
            <MenuItem
              key={provider.instanceId}
              onClick={() => void startNewThread(provider.instanceId)}
            >
              <ProviderInstanceIcon
                driverKind={provider.driver}
                displayName={provider.displayName ?? provider.driver}
                accentColor={provider.accentColor}
                size="compact"
              />
              <span className="truncate">{provider.displayName ?? provider.driver}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => void navigate({ to: "/settings/providers" })}>
            <SettingsIcon />
            Agent settings…
          </MenuItem>
        </MenuPopup>
      </Menu>
    </nav>
  );
}
