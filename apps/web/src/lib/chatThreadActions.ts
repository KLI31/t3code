import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ScopedProjectRef,
} from "@t3tools/contracts";
import type { ComposerThreadDraftState, DraftThreadEnvMode } from "../composerDraftStore";

type ComposerModelSelectionState = Pick<
  ComposerThreadDraftState,
  "activeProvider" | "modelSelectionByProvider" | "modelSelectionExplicit"
>;

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
    },
  ): Promise<unknown>;
}

export interface ChatThreadActionContext {
  readonly activeDraftThread: ThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveNewThreadModelSelectionOverride(input: {
  readonly projectDefaultSelection: ModelSelection | null;
  readonly carrySelection: ModelSelection | null;
  readonly carrySourceDraftId: string | null;
  readonly destinationDraftId: string;
}): ModelSelection | null {
  return (
    input.projectDefaultSelection ??
    (input.carrySourceDraftId === input.destinationDraftId ? null : input.carrySelection)
  );
}

export function hasExplicitComposerModelSelection(
  draft: ComposerModelSelectionState | null | undefined,
): boolean {
  const activeProvider = draft?.activeProvider;
  return (
    draft?.modelSelectionExplicit === true &&
    activeProvider !== null &&
    activeProvider !== undefined &&
    draft.modelSelectionByProvider[activeProvider] !== undefined
  );
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

interface NewThreadProjectGroup {
  readonly projectKey: string;
  readonly archived: boolean;
  readonly isScratch?: boolean | undefined;
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef>;
}

/**
 * Where "New thread" starts: the one project the sidebar is narrowed to, else the current
 * project when only one is open, else null so the caller asks which project.
 */
export function resolveNewThreadProjectRef(input: {
  readonly groups: ReadonlyArray<NewThreadProjectGroup>;
  readonly scopeKeys: ReadonlyArray<string>;
  readonly contextProjectRef: ScopedProjectRef | null;
}): ScopedProjectRef | null {
  const openGroups = input.groups.filter((group) => !group.archived);
  const scoped = openGroups.filter(
    (group) => !group.isScratch && input.scopeKeys.includes(group.projectKey),
  );
  const [scopedGroup] = scoped;
  if (scoped.length === 1 && scopedGroup) {
    const context = input.contextProjectRef;
    const contextInGroup =
      context !== null &&
      scopedGroup.memberProjectRefs.some(
        (ref) => ref.environmentId === context.environmentId && ref.projectId === context.projectId,
      );
    return contextInGroup ? context : scopeProjectRef(scopedGroup.environmentId, scopedGroup.id);
  }
  return openGroups.length === 1 || input.groups.length === 0 ? input.contextProjectRef : null;
}

export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}
