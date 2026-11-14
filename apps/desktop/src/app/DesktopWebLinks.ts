import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import type { DesktopQuickComposerLaunch } from "@t3tools/contracts";

import { QUICK_COMPOSER_LAUNCH_CHANNEL, WEB_LINK_OPEN_CHANNEL } from "../ipc/channels.ts";

export const isWebLink = (value: string) => {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
};

export const isWebPageFile = (path: string) => /\.x?html?$/i.test(path);

export class DesktopWebLinks extends Context.Service<
  DesktopWebLinks,
  {
    readonly receive: (url: string) => Effect.Effect<void>;
    /** Rides the same ready main renderer as links, so a launch during startup is not lost. */
    readonly receiveQuickComposerLaunch: (
      launch: DesktopQuickComposerLaunch,
    ) => Effect.Effect<void>;
    /** `senderId` names the app window's renderer; without it, the main window's. */
    readonly setRendererReady: (ready: boolean, senderId?: number) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopWebLinks") {}

const make = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const pending: Array<readonly [channel: string, payload: unknown]> = [];
  // Ready app-window renderers, each with its listener cleanup.
  const listening = new Map<Electron.WebContents, () => void>();

  const stopListening = (webContents: Electron.WebContents) => {
    listening.get(webContents)?.();
    listening.delete(webContents);
  };

  const flush = Effect.gen(function* () {
    if (listening.size === 0 || pending.length === 0) return;
    // Links go to the focused window when it is ready, else to any ready one.
    const main = yield* electronWindow.currentMainOrFirst;
    const target =
      Option.isSome(main) && listening.has(main.value.webContents)
        ? main.value.webContents
        : listening.keys().next().value;
    if (target === undefined) return;
    if (target.isDestroyed()) {
      stopListening(target);
      return;
    }
    for (const [channel, payload] of pending.splice(0)) target.send(channel, payload);
    yield* desktopWindow.activate.pipe(Effect.ignore);
  });

  const startListening = (webContents: Electron.WebContents) =>
    Effect.sync(() => {
      if (webContents.isDestroyed() || listening.has(webContents)) return;
      const stop = () => stopListening(webContents);
      const onNavigation = (
        event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
      ) => {
        if (event.isMainFrame && !event.isSameDocument) stop();
      };
      webContents.on("did-start-navigation", onNavigation);
      webContents.on("render-process-gone", stop);
      webContents.once("destroyed", stop);
      listening.set(webContents, () => {
        webContents.removeListener("did-start-navigation", onNavigation);
        webContents.removeListener("render-process-gone", stop);
        webContents.removeListener("destroyed", stop);
      });
    });

  return DesktopWebLinks.of({
    receive: Effect.fn("DesktopWebLinks.receive")(function (url) {
      return Effect.suspend(() => {
        pending.push([WEB_LINK_OPEN_CHANNEL, url]);
        return flush;
      });
    }),
    receiveQuickComposerLaunch: Effect.fn("DesktopWebLinks.receiveQuickComposerLaunch")(
      function (launch) {
        return Effect.suspend(() => {
          pending.push([QUICK_COMPOSER_LAUNCH_CHANNEL, launch]);
          return flush;
        });
      },
    ),
    setRendererReady: Effect.fn("DesktopWebLinks.setRendererReady")(function* (ready, senderId) {
      const window =
        senderId === undefined
          ? yield* electronWindow.currentMainOrFirst
          : yield* electronWindow.fromSender(senderId);
      if (Option.isNone(window)) return;
      const webContents = window.value.webContents;
      yield* ready ? startListening(webContents) : Effect.sync(() => stopListening(webContents));
    }, Effect.andThen(flush)),
  });
});

export const layer = Layer.effect(DesktopWebLinks, make);
