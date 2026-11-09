import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveNewThreadModelSelectionOverride,
  resolveNewThreadProjectRef,
} from "./chatThreadActions";

const PROJECT_DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const CARRIED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "carried-model",
};

describe("chatThreadActions", () => {
  it("does not carry a non-explicit model from the destination draft back into itself", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-a",
      }),
    ).toBeNull();
  });

  it("keeps the project default above any carried selection", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
      }),
    ).toEqual(PROJECT_DEFAULT_SELECTION);
  });

  it("starts a new thread in the scoped project, the only project, or asks", () => {
    const local = EnvironmentId.make("local");
    const remote = EnvironmentId.make("remote");
    const group = (key: string, environmentId = local, extra = {}) => ({
      projectKey: key,
      archived: false,
      isScratch: false,
      environmentId,
      id: ProjectId.make(key),
      memberProjectRefs: [scopeProjectRef(environmentId, ProjectId.make(key))],
      ...extra,
    });
    const current = scopeProjectRef(local, ProjectId.make("server"));
    const groups = [group("dadada"), group("server")];

    expect(
      resolveNewThreadProjectRef({ groups, scopeKeys: ["dadada"], contextProjectRef: current }),
    ).toEqual(scopeProjectRef(local, ProjectId.make("dadada")));
    expect(
      resolveNewThreadProjectRef({ groups, scopeKeys: [], contextProjectRef: current }),
    ).toBeNull();
    expect(
      resolveNewThreadProjectRef({
        groups,
        scopeKeys: ["dadada", "server"],
        contextProjectRef: current,
      }),
    ).toBeNull();
    expect(
      resolveNewThreadProjectRef({
        groups: [group("server"), group("dadada", local, { archived: true })],
        scopeKeys: [],
        contextProjectRef: current,
      }),
    ).toEqual(current);

    // A scope spanning machines keeps the current machine's copy of the project.
    const remoteCopy = scopeProjectRef(remote, ProjectId.make("server-remote"));
    const shared = group("server", local, {
      memberProjectRefs: [current, remoteCopy],
    });
    expect(
      resolveNewThreadProjectRef({
        groups: [shared, group("dadada")],
        scopeKeys: ["server"],
        contextProjectRef: remoteCopy,
      }),
    ).toEqual(remoteCopy);
  });
});
