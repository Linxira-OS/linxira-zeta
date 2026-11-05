import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/studio/primitives/icons";
import { useI18n } from "@/components/studio/i18n";

export type GitMoreActionItem = {
  readonly value: string;
  readonly label: string;
};

export type GitMoreActionGroup = {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly items: readonly GitMoreActionItem[];
  readonly disabled?: boolean;
};

const GROUP_LABEL_KEYS: Record<string, string> = {
  branch: "git.moreGroupBranch",
  worktree: "git.moreGroupWorktree",
  history: "git.moreGroupHistory",
  remote: "git.moreGroupRemote",
  github: "git.moreGroupGithub",
};

const ACTION_LABEL_KEYS: Record<string, string> = {
  "branch.create": "git.actionBranchCreate",
  "branch.switch": "git.actionBranchSwitch",
  "branch.rename": "git.actionBranchRename",
  "branch.delete": "git.actionBranchDelete",
  "worktree.root": "git.actionWorktreeRoot",
  "worktree.create": "git.actionWorktreeCreate",
  "worktree.lock": "git.actionWorktreeLock",
  "worktree.unlock": "git.actionWorktreeUnlock",
  "worktree.remove": "git.actionWorktreeRemove",
  "worktree.prune": "git.actionWorktreePrune",
  "stash": "git.actionStash",
  "stash.pop": "git.actionStashPop",
  "merge": "git.actionMerge",
  "rebase": "git.actionRebase",
  "cherry-pick": "git.actionCherryPick",
  "revert": "git.actionRevert",
  "reset": "git.actionReset",
  "tag.create": "git.actionTagCreate",
  "tag.delete": "git.actionTagDelete",
  "pull.rebase": "git.actionPullRebase",
  "pull.merge": "git.actionPullMerge",
  "push.force": "git.actionPushForce",
  "remote.add": "git.actionRemoteAdd",
  "remote.set": "git.actionRemoteSet",
  "remote.remove": "git.actionRemoteRemove",
  "auth": "git.actionAuthLogin",
  "auth.logout": "git.actionAuthLogout",
  "pr.create": "git.actionPrCreate",
  "pr.edit": "git.actionPrEdit",
  "pr.comment": "git.actionPrComment",
  "pr.review": "git.actionPrReview",
  "pr.update": "git.actionPrUpdate",
  "pr.merge": "git.actionPrMerge",
  "pr.close": "git.actionPrClose",
  "pr.reopen": "git.actionPrReopen",
};

/**
 * Actions with a Zeta gateway route. Studio's worktree/stash/merge/rebase/tag/
 * remote/GitHub/pull-rebase groups are gone: `/api/git` serves only
 * `branches`, `branch`, `checkout`, `stage`, `unstage`, `commit`, `fetch`,
 * `pull` (ff-only) and `push`, and there is no GitHub endpoint at all.
 */
export const RAW_GIT_MORE_ACTION_GROUPS = [
  {
    id: "branch",
    icon: "branch",
    items: [
      { value: "branch.create", defaultLabel: "新建并切换分支" },
      { value: "branch.switch", defaultLabel: "切换分支" },
    ],
  },
] as const;

export const GIT_MORE_ACTION_GROUPS: readonly GitMoreActionGroup[] = RAW_GIT_MORE_ACTION_GROUPS.map((g) => ({
  id: g.id,
  label: g.id === "branch" ? "分支" : g.id === "history" ? "历史" : g.id === "remote" ? "远端" : g.id === "worktree" ? "Worktree" : "GitHub",
  icon: g.icon,
  items: g.items.map((i) => ({ value: i.value, label: i.defaultLabel })),
}));

function flatten(groups: readonly GitMoreActionGroup[]): GitMoreActionItem[] {
  return groups.flatMap((group) => (group.disabled ? [] : [...group.items]));
}

export function GitMoreActionsMenu({
  disabled,
  onPick,
}: {
  readonly disabled?: boolean;
  readonly onPick?: (value: string) => void;
}) {
  const { t } = useI18n();
  const uid = useId();
  const listId = `${uid}-list`;
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 240 });
  const [active, setActive] = useState<string>();
  const activeRef = useRef(active);
  const onPickRef = useRef(onPick);
  activeRef.current = active;
  onPickRef.current = onPick;

  const groups: readonly GitMoreActionGroup[] = useMemo(
    () =>
      RAW_GIT_MORE_ACTION_GROUPS.map((group) => {
        const item: GitMoreActionGroup = {
          id: group.id,
          label: GROUP_LABEL_KEYS[group.id] ? t(GROUP_LABEL_KEYS[group.id]!) : group.id,
          icon: group.icon,
          items: group.items.map((it) => ({
            value: it.value,
            label: ACTION_LABEL_KEYS[it.value] ? t(ACTION_LABEL_KEYS[it.value]!) : it.defaultLabel,
          })),
        };
        return item;
      }),
    [t],
  );
  const flat = useMemo(() => flatten(groups), [groups]);

  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 240);
    const height = popRef.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    let top = rect.bottom + 6;
    if (height > 0 && top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
    setAnchor({ top, left, width });
  };

  const dismiss = useCallback(() => setOpen(false), []);

  const pick = useCallback(
    (value: string) => {
      onPickRef.current?.(value);
      dismiss();
    },
    [dismiss],
  );

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, groups.length]);

  useEffect(() => {
    if (!open) return;
    setActive(flat[0]?.value);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        btnRef.current?.focus();
        return;
      }
      const current = activeRef.current;
      const index = Math.max(0, flat.findIndex((item) => item.value === current));
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = (index + 1) % flat.length;
        setActive(flat[next]?.value);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = (index - 1 + flat.length) % flat.length;
        setActive(flat[prev]?.value);
      } else if (event.key === "Enter" && current) {
        event.preventDefault();
        pick(current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flat, pick, dismiss]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (btnRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      dismiss();
    };
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open, dismiss]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`git-more-trigger${open ? " is-open" : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t("git.moreActions")}
        onClick={() => {
          if (open) {
            dismiss();
            return;
          }
          setOpen(true);
        }}
      >
        <span>{t("git.moreActions")}</span>
        <Icon name={open ? "chevron-u" : "chevron-d"} extra="sm" />
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              id={listId}
              className="menu rms-pop git-more-pop"
              role="listbox"
              aria-label={t("git.moreActions")}
              style={{ top: anchor.top, left: anchor.left, minWidth: anchor.width }}
            >
              {groups.map((group) => (
                <div key={group.id} className="git-more-group" role="group" aria-label={group.label}>
                  <div className="git-more-group-label">
                    <Icon name={group.icon} extra="sm" />
                    <span>{group.label}</span>
                    <span className="spacer" />
                    <span className="tiny muted">{group.items.length}</span>
                  </div>
                  <div className="git-more-group-items">
                    {group.items.map((item) => (
                      <button
                        type="button"
                        key={item.value}
                        role="option"
                        aria-selected={active === item.value}
                        className={`menu-item${active === item.value ? " active" : ""}`}
                        disabled={group.disabled}
                        onMouseEnter={() => setActive(item.value)}
                        onClick={() => pick(item.value)}
                      >
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
