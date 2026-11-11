import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";

import { AppRoot } from "~/AppRoot";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import { draftTabKey, useWorkspaceTabsStore } from "./workspaceTabsStore";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it.each([
  { name: "another open thread", after: "next" },
  { name: "a gone thread's leftover tab", after: "gone" },
] as const)(
  "closing an empty New thread tab before $name returns to the previous tab",
  async ({ after }) => {
    await page.viewport(1400, 900);
    const thread = threadWithHistory("previous", 1);
    const next = threadWithHistory("next", 1);
    using _environment = installFakeEnvironment([thread, next]);
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    const draftId = DraftId.make("empty-draft");
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, {
        threadId: ThreadId.make("empty-draft-thread"),
      });
    const tabKey = (id: string) =>
      scopedThreadKey(scopeThreadRef(ENVIRONMENT_ID, ThreadId.make(id)));
    useWorkspaceTabsStore.setState({
      keys: [tabKey(thread.id), draftTabKey(draftId), tabKey(after)],
      pinned: [],
      surfaceKey: null,
      split: null,
    });
    const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
    await router.load();
    await using _app = await render(<AppRoot router={router} />, {
      // AppRoot brings its own router.
      router: false,
    });
    const tabs = page.getByRole("navigation", { name: "Open tabs" });
    const close = tabs.getByRole("button", { name: "Close New thread" });
    await expect
      .element(tabs.getByRole("button", { name: thread.title, exact: true }))
      .toBeVisible();

    await userEvent.click(close);

    await expect.element(close).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${thread.id}`),
    );
  },
);
