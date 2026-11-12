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
  useWorkspaceTabsStore,
  type WorkspaceSplitDirection,
  type WorkspaceTab,
} from "./workspaceTabsStore";

const TAB_CLASS =
  "group/tab relative flex h-7.5 min-w-0 max-w-56 flex-1 items-center overflow-hidden rounded-md text-sm [-webkit-app-region:no-drag]";
const TAB_BODY_CLASS =
  "flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pr-7 pl-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
const TAB_DRAG_TYPE = "application/x-xen-workspace-tab";
const ACTIVE_TAB_CLASS = "bg-foreground/10 text-foreground";
const TAB_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
// The negative margin folds in the nav's gap-0.5, so neighbors don't jump when the tab mounts or unmounts.
const COLLAPSED_TAB_FRAME = { maxWidth: "0px", opacity: 0, marginRight: "-0.125rem" };
const IDLE_TAB_CLASS =
  "bg-foreground/4 text-foreground opacity-65 hover:bg-foreground/7 hover:opacity-100";

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
}) {
  // The close button is a sibling, not a child, so assistive technology can reach it.
  return (
    <div
      data-tab-key={tabKey}
      draggable={!titleInput}
      {...drag}
      className={cn(TAB_CLASS, active ? ACTIVE_TAB_CLASS : IDLE_TAB_CLASS)}
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

function findTabElement(nav: HTMLElement | null, key: string): HTMLElement | undefined {
  return Array.from(nav?.children ?? []).find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.dataset.tabKey === key,
  );
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
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const draggingKeyRef = useRef<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const previousKeysRef = useRef<ReadonlyArray<string> | null>(null);
  // Tabs playing their exit; they stay in the store until it ends.
  const closingKeysRef = useRef(new Set<string>());
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
    if (promotedFrom) replaceTab(promotedFrom, routedKey);
    else openTab(routedKey);
    const surface = shown ? parseWorkspaceTab(shown) : null;
    if (surface && surface.kind !== "draft" && surfaceOwnerKey(surface.threadRef) !== routedKey) {
      hideSurface();
    }
  }, [routedKey, openTab, closeTab, replaceTab, hideSurface]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- grows newly opened tab elements in with the Web Animations API before they first paint
  useLayoutEffect(() => {
    const previous = previousKeysRef.current;
    previousKeysRef.current = keys;
    if (!previous || !tabAnimation.active) return;
    keys.forEach((key, index) => {
      if (previous.includes(key)) return;
      // A draft tab swapped for its sent thread keeps its place instead of growing in again.
      const swapped = previous[index];
      if (swapped !== undefined && !keys.includes(swapped)) return;
      const element = findTabElement(navRef.current, key);
      element?.animate(
        [
          COLLAPSED_TAB_FRAME,
          { maxWidth: `${element.offsetWidth}px`, opacity: 1, marginRight: "0px" },
        ],
        { duration: tabAnimation.durationMs, easing: TAB_EASE },
      );
    });
  }, [keys, tabAnimation.active, tabAnimation.durationMs]);

  const showThread = useShowThreadInMain();
  const splitShown = splitKey !== null && splitKey !== routedKey;

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

  const close = (key: string) => {
    if (closingKeysRef.current.has(key)) return;
    const tab = parseWorkspaceTab(key);
    if (key === activeKey) {
      const shownKeys = keys.filter((open) => {
        const openTab = parseWorkspaceTab(open);
        return (
          open === key ||
          (openTab !== null && !closingKeysRef.current.has(open) && isTabShown(openTab))
        );
      });
      // The split pane's thread takes over the main pane when the main one closes.
      const next =
        (splitShown && key === routedKey ? splitKey : null) ??
        neighborTabKey(shownKeys, key, { preferPrevious: tab?.kind === "draft" });
      const nextTab = next ? parseWorkspaceTab(next) : null;
      if (next && nextTab) select(next, nextTab);
      else {
        hideSurface();
        if (key === routedKey) void navigate({ to: "/" });
      }
    }
    // Thread and file tabs come back with the reopen shortcut. Closing a terminal tab ends its shell.
    if (tab?.kind === "terminal")
      terminalActions.closeTerminalSession(tab.terminalId, tab.threadRef);
    else if (tab?.kind === "thread" || tab?.kind === "file") {
      useClosedViewStore
        .getState()
        .remember({ kind: "workspace-tab", threadRef: tab.threadRef, key });
    }
    const element = tabAnimation.active ? findTabElement(navRef.current, key) : undefined;
    if (!element) {
      closeTab(key);
      return;
    }
    closingKeysRef.current.add(key);
    element.inert = true;
    const finish = () => {
      closingKeysRef.current.delete(key);
      closeTab(key);
    };
    // A cancelled exit, as when the tab bar unmounts, still closes the tab.
    element
      .animate(
        [
          { maxWidth: `${element.offsetWidth}px`, opacity: 1, marginRight: "0px" },
          COLLAPSED_TAB_FRAME,
        ],
        {
          duration: tabAnimation.durationMs,
          easing: TAB_EASE,
          fill: "forwards",
        },
      )
      .finished.then(finish, finish);
  };

  const runTabShortcut = useEffectEvent((target: "next" | "previous" | "close" | number) => {
    if (target === "close") {
      if (!activeKey) return false;
      close(activeKey);
      return;
    }
    const shownKeys = keys.filter((key) => !closingKeysRef.current.has(key));
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
    onDragEnter: () => {
      const dragging = draggingKeyRef.current;
      if (dragging && dragging !== key) moveTab(dragging, key);
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
    const items: ContextMenuItem<
      WorkspaceSplitDirection | "rename" | "pin" | "close-split" | "close"
    >[] = [
      ...threadItems,
      {
        id: "pin",
        label: pinnedKeys.includes(key) ? "Unpin tab" : "Pin tab",
        separatorBefore: threadItems.length > 0,
      },
      ...(splitShown ? [{ id: "close-split" as const, label: "Close split" }] : []),
      { id: "close", label: "Close tab", separatorBefore: true },
    ];
    void api.contextMenu.show(items, { x: event.clientX, y: event.clientY }).then((action) => {
      if (action === "rename") setRenamingKey(key);
      else if (action === "pin") togglePin(key);
      else if (action === "right" || action === "down") openSplit(key, action);
      else if (action === "close-split") closeSplit();
      else if (action === "close") close(key);
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
        "hidden h-(--workspace-topbar-height) shrink-0 items-center gap-0.5 overflow-x-auto pr-(--workspace-tabs-end-inset) pl-1.5 md:flex",
        isElectron && "drag-region",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
      aria-label="Open tabs"
    >
      {keys.map((key) => {
        const tab = parseWorkspaceTab(key);
        if (!tab) return null;
        return (
          <WorkspaceTabButton
            key={key}
            tabKey={key}
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
      })}
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
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
