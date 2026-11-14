import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { useGT } from "gt-react";
import {
  CheckIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  Columns2Icon,
  GroupIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  Rows2Icon,
  UngroupIcon,
  XIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../ui/menu";
import {
  TAB_GROUP_COLORS,
  type TabGroupColor,
  type WorkspaceSplitDirection,
  type WorkspaceTabGroup,
} from "./workspaceTabsStore";

// Full class strings so Tailwind sees them: the label's dot and the tinted box around the group.
export const GROUP_COLOR_CLASS: Record<TabGroupColor, { dot: string; box: string }> = {
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

/** A group's shown name: its title, or its color's name while it has none. */
export function useGroupLabel(): (group: WorkspaceTabGroup) => string {
  const colorName = useColorName();
  const gt = useGT();
  return (group) => group.title || gt("{color} group", { color: colorName(group.color) });
}

function useColorName(): (color: TabGroupColor) => string {
  const gt = useGT();
  // Literal calls so `gt generate` extracts each name.
  const names: Record<TabGroupColor, string> = {
    grey: gt("Grey"),
    blue: gt("Blue"),
    red: gt("Red"),
    yellow: gt("Yellow"),
    green: gt("Green"),
    pink: gt("Pink"),
    purple: gt("Purple"),
    cyan: gt("Cyan"),
    orange: gt("Orange"),
  };
  return (color) => names[color];
}

function GroupDot({ color }: { color: TabGroupColor }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", GROUP_COLOR_CLASS[color].dot)}
    />
  );
}

export type TabMenuTarget =
  | { readonly kind: "tab"; readonly key: string; readonly x: number; readonly y: number }
  | { readonly kind: "group"; readonly groupId: string; readonly x: number; readonly y: number };

export interface TabMenuTab {
  /** Thread tabs can be renamed and split; null for other kinds. */
  readonly thread: { readonly canRename: boolean; readonly inMain: boolean } | null;
  readonly pinned: boolean;
  readonly groupId: string | null;
}

export function WorkspaceTabMenu({
  target,
  open,
  onOpenChange,
  tab,
  groups,
  splitShown,
  onRename,
  onSplit,
  onNewGroup,
  onAddToGroup,
  onLeaveGroup,
  onTogglePin,
  onCloseSplit,
  onClose,
  onRenameGroup,
  onToggleCollapsed,
  onSetColor,
  onUngroup,
  onCloseGroup,
}: {
  target: TabMenuTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: TabMenuTab | null;
  groups: ReadonlyArray<WorkspaceTabGroup>;
  splitShown: boolean;
  onRename: () => void;
  onSplit: (direction: WorkspaceSplitDirection) => void;
  onNewGroup: () => void;
  onAddToGroup: (groupId: string) => void;
  onLeaveGroup: () => void;
  onTogglePin: () => void;
  onCloseSplit: () => void;
  onClose: () => void;
  onRenameGroup: () => void;
  onToggleCollapsed: () => void;
  onSetColor: (color: TabGroupColor) => void;
  onUngroup: () => void;
  onCloseGroup: () => void;
}) {
  const gt = useGT();
  const groupLabel = useGroupLabel();
  const colorName = useColorName();
  const group =
    target?.kind === "group" ? groups.find((entry) => entry.id === target.groupId) : null;
  const otherGroups = groups.filter((entry) => entry.id !== tab?.groupId);
  const anchor = target
    ? { getBoundingClientRect: () => new DOMRect(target.x, target.y, 0, 0) }
    : undefined;

  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuPopup anchor={anchor} align="start" side="bottom" sideOffset={2} className="min-w-52">
        {target?.kind === "tab" && tab ? (
          <>
            {tab.thread ? (
              <>
                <MenuItem disabled={!tab.thread.canRename} onClick={onRename}>
                  <PencilIcon />
                  {gt("Rename")}
                </MenuItem>
                <MenuItem disabled={tab.thread.inMain} onClick={() => onSplit("right")}>
                  <Columns2Icon />
                  {gt("Split right")}
                </MenuItem>
                <MenuItem disabled={tab.thread.inMain} onClick={() => onSplit("down")}>
                  <Rows2Icon />
                  {gt("Split down")}
                </MenuItem>
                <MenuSeparator />
              </>
            ) : null}
            {otherGroups.length > 0 ? (
              <MenuSub>
                <MenuSubTrigger>
                  <GroupIcon />
                  {gt("Add to group")}
                </MenuSubTrigger>
                <MenuSubPopup className="min-w-44">
                  <MenuItem onClick={onNewGroup}>
                    <PlusIcon />
                    {gt("New group")}
                  </MenuItem>
                  <MenuSeparator />
                  {otherGroups.map((entry) => (
                    <MenuItem key={entry.id} onClick={() => onAddToGroup(entry.id)}>
                      <GroupDot color={entry.color} />
                      <span className="truncate">{groupLabel(entry)}</span>
                    </MenuItem>
                  ))}
                </MenuSubPopup>
              </MenuSub>
            ) : (
              <MenuItem onClick={onNewGroup}>
                <GroupIcon />
                {gt("Add to new group")}
              </MenuItem>
            )}
            {tab.groupId ? (
              <MenuItem onClick={onLeaveGroup}>
                <UngroupIcon />
                {gt("Remove from group")}
              </MenuItem>
            ) : null}
            <MenuItem onClick={onTogglePin}>
              {tab.pinned ? <PinOffIcon /> : <PinIcon />}
              {tab.pinned ? gt("Unpin tab") : gt("Pin tab")}
            </MenuItem>
            <MenuSeparator />
            {splitShown ? (
              <MenuItem onClick={onCloseSplit}>
                <Columns2Icon />
                {gt("Close split")}
              </MenuItem>
            ) : null}
            <MenuItem onClick={onClose}>
              <XIcon />
              {gt("Close tab")}
            </MenuItem>
          </>
        ) : null}
        {group ? (
          <>
            <MenuItem onClick={onRenameGroup}>
              <PencilIcon />
              {gt("Rename group")}
            </MenuItem>
            <MenuItem onClick={onToggleCollapsed}>
              {group.collapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
              {group.collapsed ? gt("Expand group") : gt("Collapse group")}
            </MenuItem>
            <MenuSeparator />
            <MenuPrimitive.RadioGroup
              aria-label={gt("Color")}
              value={group.color}
              onValueChange={(color: TabGroupColor) => onSetColor(color)}
              className="flex flex-wrap gap-1 px-1.5 py-1"
            >
              {TAB_GROUP_COLORS.map((color) => (
                <MenuPrimitive.RadioItem
                  key={color}
                  value={color}
                  closeOnClick
                  aria-label={colorName(color)}
                  className="grid size-6 cursor-pointer place-items-center rounded-full outline-none data-highlighted:bg-accent"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-4 place-items-center rounded-full text-white",
                      GROUP_COLOR_CLASS[color].dot,
                    )}
                  >
                    {color === group.color ? (
                      <CheckIcon className="size-3" strokeWidth={3} />
                    ) : null}
                  </span>
                </MenuPrimitive.RadioItem>
              ))}
            </MenuPrimitive.RadioGroup>
            <MenuSeparator />
            <MenuItem onClick={onUngroup}>
              <UngroupIcon />
              {gt("Ungroup")}
            </MenuItem>
            <MenuItem variant="destructive" onClick={onCloseGroup}>
              <XIcon />
              {gt("Close group")}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
