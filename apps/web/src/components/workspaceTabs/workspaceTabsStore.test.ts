import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

// The store binds its persist storage at import, and Node has no localStorage.
vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
});

import {
  draftTabKey,
  fileTabKey,
  parseWorkspaceTab,
  snapSplitRatio,
  terminalTabKey,
  useWorkspaceTabsStore,
} from "./workspaceTabsStore";

const threadRef = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));
const threadKey = scopedThreadKey(threadRef);

describe("parseWorkspaceTab", () => {
  it("reads persisted thread keys and round-trips file and terminal tabs", () => {
    expect(parseWorkspaceTab(threadKey)).toEqual({ kind: "thread", threadRef });
    expect(parseWorkspaceTab(fileTabKey(threadKey, "src/a:b.ts"))).toEqual({
      kind: "file",
      threadRef,
      path: "src/a:b.ts",
    });
    expect(parseWorkspaceTab(terminalTabKey(threadKey, "term-2"))).toEqual({
      kind: "terminal",
      threadRef,
      terminalId: "term-2",
    });
    expect(parseWorkspaceTab(draftTabKey("draft-1"))).toEqual({
      kind: "draft",
      draftId: "draft-1",
    });
    expect(parseWorkspaceTab(fileTabKey(threadKey, ""))).toBeNull();
    expect(parseWorkspaceTab("garbage")).toBeNull();
  });
});

function setup() {
  useWorkspaceTabsStore.setState({
    keys: ["a", "b"],
    pinned: [],
    surfaceKey: null,
    split: null,
    groups: [],
    tabGroup: {},
  });
  return useWorkspaceTabsStore.getState();
}

describe("workspace tabs", () => {
  it("swaps a draft tab for its sent thread in place", () => {
    const store = setup();
    store.open("draft");
    store.open("c");
    store.replace("draft", "thread");
    expect(useWorkspaceTabsStore.getState().keys).toEqual(["a", "b", "thread", "c"]);
    store.replace("thread", "a");
    expect(useWorkspaceTabsStore.getState().keys).toEqual(["a", "b", "c"]);
  });

  it("moves a dragged tab to its drop target's place, either way", () => {
    const store = setup();
    store.open("c");
    store.move("a", "c");
    expect(useWorkspaceTabsStore.getState().keys).toEqual(["b", "c", "a"]);
    store.move("a", "b");
    expect(useWorkspaceTabsStore.getState().keys).toEqual(["a", "b", "c"]);
    store.move("gone", "b");
    expect(useWorkspaceTabsStore.getState().keys).toEqual(["a", "b", "c"]);
  });

  it("keeps pinned tabs first, out of reach of drags and the tab cap", () => {
    const store = setup();
    store.open("c");
    store.togglePin("c");
    store.togglePin("b");
    expect(useWorkspaceTabsStore.getState()).toMatchObject({
      keys: ["c", "b", "a"],
      pinned: ["c", "b"],
    });
    store.move("a", "c");
    expect(useWorkspaceTabsStore.getState().keys).toEqual(["c", "b", "a"]);

    for (let index = 0; index < 12; index += 1) store.open(`t${index}`);
    const { keys } = useWorkspaceTabsStore.getState();
    expect(keys.slice(0, 2)).toEqual(["c", "b"]);
    expect(keys).toHaveLength(12);
    expect(keys).not.toContain("a");

    store.replace("b", "b-thread");
    store.togglePin("c");
    expect(useWorkspaceTabsStore.getState().keys.slice(0, 2)).toEqual(["b-thread", "c"]);
    expect(useWorkspaceTabsStore.getState().pinned).toEqual(["b-thread"]);
  });
});

describe("tab groups", () => {
  const state = () => useWorkspaceTabsStore.getState();

  it("keeps a group's tabs together as tabs join, leave, and get dragged", () => {
    const store = setup();
    store.open("c");
    store.open("d");
    const group = store.createGroup("a")!;
    store.addToGroup("c", group);
    expect(state()).toMatchObject({ keys: ["a", "c", "b", "d"], tabGroup: { a: group, c: group } });

    // Dragged onto a member it joins; dragged onto an outsider it leaves.
    store.move("d", "a");
    expect(state()).toMatchObject({ keys: ["d", "a", "c", "b"], tabGroup: { d: group } });
    store.move("d", "b");
    expect(state().keys).toEqual(["a", "c", "b", "d"]);
    expect(state().tabGroup.d).toBeUndefined();

    // Leaving from the middle steps past the rest of the group.
    store.addToGroup("b", group);
    store.removeFromGroup("a");
    expect(state()).toMatchObject({ keys: ["c", "b", "a", "d"], tabGroup: { c: group, b: group } });

    // A new group taken from a member's tab moves it out past its old group.
    const other = store.createGroup("c")!;
    expect(state()).toMatchObject({ keys: ["b", "c", "a", "d"], tabGroup: { b: group, c: other } });
  });

  it("drops a group once closing, pinning, or ungrouping empties it", () => {
    const store = setup();
    const group = store.createGroup("a")!;
    store.addToGroup("b", group);
    store.close("a");
    store.togglePin("b");
    expect(state()).toMatchObject({ groups: [], tabGroup: {} });

    const next = store.createGroup("b")!;
    expect(state().pinned).toEqual([]);
    store.replace("b", "b-thread");
    expect(state().tabGroup).toEqual({ "b-thread": next });
    store.ungroup(next);
    expect(state()).toMatchObject({ groups: [], tabGroup: {} });
  });
});

describe("workspace split", () => {
  it("opens a split on a tab, swaps its thread, resizes and closes it", () => {
    const store = setup();
    store.openSplit("c", "right");
    expect(useWorkspaceTabsStore.getState()).toMatchObject({
      keys: ["a", "b", "c"],
      split: { key: "c", direction: "right", ratio: 0.5 },
    });

    store.setSplitKey("a");
    store.setSplitRatio(0.95);
    expect(useWorkspaceTabsStore.getState().split).toEqual({
      key: "a",
      direction: "right",
      ratio: 0.8,
    });

    store.openSplit("b", "down");
    expect(useWorkspaceTabsStore.getState().split).toEqual({
      key: "b",
      direction: "down",
      ratio: 0.8,
    });

    store.closeSplit();
    expect(useWorkspaceTabsStore.getState().split).toBeNull();
  });

  it("closes the split with its tab, and only then", () => {
    const store = setup();
    store.openSplit("b", "right");
    store.close("a");
    expect(useWorkspaceTabsStore.getState().split?.key).toBe("b");
    store.close("b");
    expect(useWorkspaceTabsStore.getState()).toMatchObject({ keys: [], split: null });
  });

  it("snaps a dragged handle to thirds and the middle within 12px", () => {
    expect(snapSplitRatio(0.51, 1000)).toEqual({ ratio: 0.5, snapped: true });
    expect(snapSplitRatio(0.34, 600)).toEqual({ ratio: 1 / 3, snapped: true });
    expect(snapSplitRatio(0.6, 1000)).toEqual({ ratio: 0.6, snapped: false });
    expect(snapSplitRatio(0.05, 1000)).toEqual({ ratio: 0.2, snapped: false });
  });
});
