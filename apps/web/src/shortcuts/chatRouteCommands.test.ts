import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import * as commandPalette from "../commandPaletteBus";
import * as newThread from "../hooks/useHandleNewThread";
import * as settings from "../hooks/useSettings";
import * as storage from "../hooks/useLocalStorage";
import * as threadActions from "../lib/chatThreadActions";
import * as entities from "../state/entities";
import * as projectsState from "../state/projects";
import { Atom } from "effect/reactivity";
import type { Project } from "../types";
import { installChatRouteCommands } from "./chatRouteCommands";
import * as dispatcher from "./dispatcher";

function project(id: string): Project {
  return {
    id: ProjectId.make(id),
    environmentId: EnvironmentId.make("local"),
    title: id,
    workspaceRoot: `/projects/${id}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
  };
}

describe("new thread commands", () => {
  it.each([
    { mode: "normal", count: 2, command: "chat.new", starts: "picker" },
    { mode: "boring", count: 2, command: "chat.new", starts: "picker" },
    { mode: "boring", count: 1, command: "chat.new", starts: "project" },
    { mode: "boring", count: 2, command: "chat.newLocal", starts: "local" },
  ] as const)("$mode sidebar, $count projects, $command: starts $starts", (scenario) => {
    using _settings = vi.spyOn(settings, "getClientSettings").mockReturnValue({
      ...DEFAULT_CLIENT_SETTINGS,
      boringSidebarEnabled: scenario.mode === "boring",
    });
    using _projects = vi
      .spyOn(entities, "readProjects")
      .mockReturnValue([project("active"), project("idle")].slice(0, scenario.count));
    using _ready = vi
      .spyOn(projectsState, "defaultProjectFallbackReadyAtom")
      .mockReturnValue(Atom.make(true));
    using storedProject = vi.spyOn(storage, "getLocalStorageItem").mockReturnValue("local:active");
    using openPicker = vi.spyOn(commandPalette, "openCommandPalette").mockImplementation(() => {});
    using startLocal = vi.spyOn(threadActions, "startNewThreadFromContext").mockResolvedValue(true);
    const startInProject = vi.fn().mockResolvedValue(null);
    using _handler = vi
      .spyOn(newThread, "createNewThreadHandler")
      .mockReturnValue(startInProject as unknown as newThread.NewThreadHandler);
    using register = vi.spyOn(dispatcher, "registerCommands").mockReturnValue(() => {});
    const router = { state: { matches: [] } } as unknown as AnyRouter;
    using stack = new DisposableStack();
    stack.defer(installChatRouteCommands(router));
    const commands = register.mock.calls[0]![0];
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    storedProject.mockReturnValue("local:idle");
    commands[scenario.command]!(event);

    expect(openPicker.mock.calls.length > 0).toBe(scenario.starts === "picker");
    expect(startInProject.mock.calls[0]?.[0]).toEqual(
      scenario.starts === "project"
        ? { environmentId: EnvironmentId.make("local"), projectId: ProjectId.make("active") }
        : undefined,
    );
    expect(startLocal.mock.calls.length).toBe(scenario.starts === "local" ? 1 : 0);
    if (scenario.starts === "local") {
      expect(startLocal.mock.calls[0]![0].defaultProjectRef).toEqual({
        environmentId: "local",
        projectId: "idle",
      });
    }
  });
});
