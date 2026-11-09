import {
  AuthPreviewOperateScope,
  type EnvironmentId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { isPreviewAvailableFor } from "../browser/previewRuntime";
import { isCommandPaletteOpen, openCommandPalette } from "../commandPaletteBus";
import { useComposerDraftStore } from "../composerDraftStore";
import { dispatchPreviewAction, type PreviewAction } from "../components/preview/previewActionBus";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { createNewThreadHandler, resolveDefaultProjectRef } from "../hooks/useHandleNewThread";
import { getClientSettings } from "../hooks/useSettings";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { createScratchProjectActions } from "../hooks/useScratchProject";
import {
  resolveNewThreadProjectRef,
  resolveThreadActionProjectRef,
  startNewThreadFromContext,
} from "../lib/chatThreadActions";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects, readThreadShell } from "../state/entities";
import { environmentPresentations } from "../state/presentation";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { readEnvironmentScope } from "../state/session";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { type CommandHandler, registerCommands } from "./dispatcher";

const CHAT_ROUTE_ID = "/_chat";

/** Where "New thread" starts, read at click time; null means ask which project. */
export function readNewThreadProjectRef(
  contextProjectRef: ScopedProjectRef | null,
): ScopedProjectRef | null {
  const settings = getClientSettings();
  // Grouped like the sidebar, so the button, the shortcut and the tab bar agree.
  const groups = buildSidebarProjectSnapshots({
    projects: readProjects(),
    groupScratchProjects: true,
    settings: selectProjectGroupingSettings(settings),
    primaryEnvironmentId: appAtomRegistry.get(primaryEnvironmentIdAtom),
    resolveEnvironmentLabel: () => null,
  });
  return resolveNewThreadProjectRef({
    groups,
    scopeKeys: useUiStateStore.getState().sidebarProjectScopeKeys,
    contextProjectRef,
  });
}

/**
 * New-thread and preview commands, live while a chat route is showing and no
 * modal page (Settings, Usage) covers it. Everything is read at event time, so
 * the scope is registered once instead of re-registering on every store change.
 */
export function installChatRouteCommands(router: AnyRouter): () => void {
  const handleNewThread = createNewThreadHandler(router);
  const scratch = createScratchProjectActions({
    environments: () =>
      [...appAtomRegistry.get(environmentPresentations.presentationsAtom)].map(
        ([environmentId, presentation]) => ({ ...presentation, environmentId }),
      ),
    primaryEnvironmentId: () => appAtomRegistry.get(primaryEnvironmentIdAtom),
    registry: appAtomRegistry,
    handleNewThread,
  });

  const readRouteTarget = () => resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const readRouteThreadRef = () => {
    const target = readRouteTarget();
    return target?.kind === "server" ? target.threadRef : null;
  };
  const readPreviewOpen = () => {
    const threadRef = readRouteThreadRef();
    // Store-only on purpose: the URL-aware arbitration lives in ChatView's
    // preview toggle, which the action bus reaches.
    return threadRef
      ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) === "preview"
      : false;
  };
  const readThreadContext = () => {
    const target = readRouteTarget();
    const drafts = useComposerDraftStore.getState();
    const activeThread = target?.kind === "server" ? readThreadShell(target.threadRef) : null;
    const activeDraftThread = target
      ? target.kind === "server"
        ? drafts.getDraftThread(target.threadRef)
        : drafts.getDraftSession(target.draftId)
      : null;
    return {
      activeDraftThread,
      activeThread: activeThread ?? undefined,
      defaultProjectRef: resolveDefaultProjectRef(
        readProjects(),
        useUiStateStore.getState().projectOrder,
      ),
      handleNewThread,
    };
  };
  const canOperatePreview = (environmentId: EnvironmentId) =>
    readEnvironmentScope(environmentId, AuthPreviewOperateScope);

  const claim = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const startNewLocal: CommandHandler = (event) => {
    claim(event);
    // With no current or open project, such as when every project is archived, pick one.
    void startNewThreadFromContext(readThreadContext()).then((started) => {
      if (!started) openCommandPalette({ open: "new-thread-in" });
    });
  };

  const previewCommand =
    (action: PreviewAction): CommandHandler =>
    (event) => {
      claim(event);
      const threadRef = readRouteThreadRef();
      if (threadRef && canOperatePreview(threadRef.environmentId)) dispatchPreviewAction(action);
    };

  return registerCommands(
    {
      "chat.newLocal": startNewLocal,
      "chat.newWithoutProject": (event) => {
        const { activeThread, activeDraftThread } = readThreadContext();
        const environmentId = scratch.scratchEnvironmentId(
          activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null,
        );
        if (environmentId === null) return;
        claim(event);
        void scratch.startScratchThread(environmentId);
      },
      "chat.new": (event) => {
        claim(event);
        const projectRef = readNewThreadProjectRef(
          resolveThreadActionProjectRef(readThreadContext()),
        );
        if (projectRef) void handleNewThread(projectRef);
        else openCommandPalette({ open: "new-thread-in" });
      },
      "preview.toggle": (event) => {
        claim(event);
        const threadRef = readRouteThreadRef();
        if (!threadRef || (!canOperatePreview(threadRef.environmentId) && !readPreviewOpen())) {
          return;
        }
        if (!isPreviewAvailableFor(threadRef.environmentId)) {
          toastManager.add(
            stackedThreadToast({
              type: "info",
              title: "Preview is desktop-only",
              description: "Open Xen Code in the desktop app to use the in-app preview.",
            }),
          );
          return;
        }
        dispatchPreviewAction("toggle-panel");
      },
      "preview.refresh": previewCommand("refresh"),
      "preview.focusUrl": previewCommand("focus-url"),
      "preview.zoomIn": previewCommand("zoom-in"),
      "preview.zoomOut": previewCommand("zoom-out"),
      "preview.resetZoom": previewCommand("reset-zoom"),
    },
    {
      when: () =>
        router.state.matches.some((match) => match.routeId === CHAT_ROUTE_ID) &&
        !router.state.matches.some((match) => isAppModalPage(match.pathname)) &&
        !isCommandPaletteOpen(),
      context: () => {
        const threadRef = readRouteThreadRef();
        return {
          terminalOpen: threadRef
            ? selectThreadTerminalUiState(
                useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                threadRef,
              ).terminalOpen
            : false,
          previewOpen: readPreviewOpen(),
        };
      },
      onKeyDown: (event) => {
        if (event.key !== "Escape") return false;
        const selection = useThreadSelectionStore.getState();
        if (selection.selectedThreadKeys.size === 0) return false;
        event.preventDefault();
        selection.clearSelection();
      },
    },
  );
}
