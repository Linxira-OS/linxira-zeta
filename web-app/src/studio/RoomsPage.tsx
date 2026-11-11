/**
 * Local Super/Repo/Main rooms — contacts, ordered chat, and residents.
 *
 * Reads only `rooms.list`, `room.get`, `room.log.read`, and
 * `room.contacts.list`; every write is a `room.*` command on the real host
 * family. Unsupported capabilities stay invisible because the host manifest
 * only advertises registered handlers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CommandInput,
  CommandName,
  LocalRoomDeliveryMode,
  LocalRoomEventReadModel,
  LocalRoomKind,
  LocalRoomMemberReadModel,
  LocalRoomMemberRole,
  LocalRoomSnapshotReadModel,
  LocalRoomSummaryReadModel,
  StudioClient,
} from "@linxiraos/studio-contract";
import { hostErrorMessage, waitReceipt } from "./hostError";
import { Icon } from "./icons";
import { useI18n } from "./i18n";

type Phase = "loading" | "ready" | "error";

const MODES: ReadonlyArray<LocalRoomDeliveryMode> = [
  "parallel",
  "serial",
  "mention",
];
const KINDS: ReadonlyArray<LocalRoomKind> = ["super", "repo", "main"];
const ROLES: ReadonlyArray<LocalRoomMemberRole> = [
  "super",
  "repo",
  "main",
  "resident",
];

function formatTime(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

function statusClass(status: LocalRoomMemberReadModel["status"]): string {
  return `room-status status-${status}`;
}

export function RoomsPage({ client }: { client: StudioClient }) {
  const { t, resolvedLanguage } = useI18n();
  const [phase, setPhase] = useState<Phase>("loading");
  const [rooms, setRooms] = useState<ReadonlyArray<LocalRoomSummaryReadModel>>(
    [],
  );
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<
    LocalRoomSnapshotReadModel | undefined
  >(undefined);
  const [contacts, setContacts] = useState<
    ReadonlyArray<LocalRoomMemberReadModel>
  >([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<LocalRoomDeliveryMode>("parallel");
  const [replyTo, setReplyTo] = useState<number | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createKind, setCreateKind] = useState<LocalRoomKind>("main");
  const [createRepo, setCreateRepo] = useState("");
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [memberRole, setMemberRole] = useState<LocalRoomMemberRole>("main");
  const [memberName, setMemberName] = useState("");

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.room.roomId === selected)?.room,
    [rooms, selected],
  );

  const loadRooms = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      const result = await client.query("rooms.list", {});
      setRooms(result.rooms);
      setSelected((current) => current ?? result.rooms[0]?.room.roomId);
      setPhase("ready");
    } catch (cause) {
      setError(hostErrorMessage(cause, t("rooms.error")));
      setPhase("error");
    }
  }, [client, t]);

  const loadSelected = useCallback(
    async (roomId: string) => {
      try {
        const [next, contactList] = await Promise.all([
          client.query("room.get", { roomId }),
          client.query("room.contacts.list", { roomId }),
        ]);
        setSnapshot(next);
        setContacts(contactList.contacts);
        if (next.lastSeq > 0) {
          const handle = await client.command("room.markRead", {
            roomId,
            memberId: "user",
            seq: next.lastSeq,
          });
          await waitReceipt(client, handle.requestId);
        }
      } catch (cause) {
        setError(hostErrorMessage(cause, t("rooms.error")));
      }
    },
    [client, t],
  );

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (selected === undefined) {
      setSnapshot(undefined);
      setContacts([]);
      return;
    }
    void loadSelected(selected);
  }, [selected, loadSelected]);

  const run = useCallback(
    async (work: () => Promise<void>, okText: string) => {
      setBusy(true);
      setNotice("");
      try {
        await work();
        setNotice(okText);
      } catch (cause) {
        setError(hostErrorMessage(cause, t("rooms.error")));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const command = useCallback(
    async <TName extends CommandName>(
      name: TName,
      input: CommandInput<TName>,
    ): Promise<void> => {
      const handle = await client.command(name, input);
      await waitReceipt(client, handle.requestId);
    },
    [client],
  );

  const send = useCallback(async () => {
    if (!selected || !draft.trim()) return;
    const body = draft.trim();
    await run(async () => {
      await command("room.post", {
        roomId: selected,
        body,
        mode,
        ...(replyTo === undefined ? {} : { replyTo }),
      });
      setDraft("");
      setReplyTo(undefined);
      await loadSelected(selected);
      await loadRooms();
    }, t("rooms.sent"));
  }, [
    command,
    draft,
    loadRooms,
    loadSelected,
    mode,
    replyTo,
    run,
    selected,
    t,
  ]);

  const createRoom = useCallback(async () => {
    if (!createName.trim()) return;
    await run(async () => {
      await command("room.create", {
        roomKind: createKind,
        name: createName.trim(),
        ...(createRepo.trim() ? { repoRoot: createRepo.trim() } : {}),
      });
      setCreateName("");
      setCreateRepo("");
      setCreateOpen(false);
      await loadRooms();
    }, t("rooms.created"));
  }, [command, createKind, createName, createRepo, loadRooms, run, t]);

  const addMember = useCallback(async () => {
    if (!selected || !memberId.trim()) return;
    await run(async () => {
      await command("room.member.add", {
        roomId: selected,
        memberId: memberId.trim(),
        role: memberRole,
        ...(memberName.trim() ? { displayName: memberName.trim() } : {}),
      });
      setMemberId("");
      setMemberName("");
      setMemberOpen(false);
      await loadSelected(selected);
    }, t("rooms.memberAdded"));
  }, [
    command,
    loadSelected,
    memberId,
    memberName,
    memberRole,
    run,
    selected,
    t,
  ]);

  const stopRound = useCallback(async () => {
    if (!selected || !snapshot) return;
    const round = snapshot.rounds.find((item) => item.status === "open");
    if (!round) return;
    await run(async () => {
      await command("room.round.stop", {
        roomId: selected,
        roundId: round.roundId,
      });
      await loadSelected(selected);
    }, t("rooms.stopped"));
  }, [command, loadSelected, run, selected, snapshot, t]);

  const resident = useCallback(
    async (member: LocalRoomMemberReadModel, action: "park" | "revive") => {
      if (!selected) return;
      await run(
        async () => {
          await command(
            action === "park" ? "room.resident.park" : "room.resident.revive",
            {
              roomId: selected,
              agentId: member.memberId,
            },
          );
          await loadSelected(selected);
        },
        action === "park" ? t("rooms.parked") : t("rooms.revived"),
      );
    },
    [command, loadSelected, run, selected, t],
  );

  const insertMention = useCallback((member: LocalRoomMemberReadModel) => {
    setDraft(
      (current) => `${current}${current.trim() ? " " : ""}@${member.memberId} `,
    );
  }, []);

  if (phase === "loading" && rooms.length === 0) {
    return (
      <div className="rooms-page page-wide room-empty">
        {t("rooms.loading")}
      </div>
    );
  }

  return (
    <div className="rooms-page page-wide">
      <aside className="room-sidebar">
        <header className="room-sidebar-head">
          <div>
            <h2 className="room-title">{t("rooms.title")}</h2>
            <p className="muted small">{t("rooms.subtitle")}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setCreateOpen((value) => !value)}
            aria-label={t("rooms.create")}
            data-tip={t("rooms.create")}
          >
            <Icon name="plus" />
          </button>
        </header>
        {createOpen ? (
          <div className="room-form">
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder={t("rooms.name")}
              aria-label={t("rooms.name")}
            />
            <select
              value={createKind}
              onChange={(event) =>
                setCreateKind(event.target.value as LocalRoomKind)
              }
              aria-label={t("rooms.kindLabel")}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`rooms.kind.${kind}`)}
                </option>
              ))}
            </select>
            {createKind === "repo" ? (
              <input
                value={createRepo}
                onChange={(event) => setCreateRepo(event.target.value)}
                placeholder={t("rooms.repoRoot")}
                aria-label={t("rooms.repoRoot")}
              />
            ) : null}
            <button
              type="button"
              className="btn small"
              disabled={busy || !createName.trim()}
              onClick={() => void createRoom()}
            >
              {t("rooms.create")}
            </button>
          </div>
        ) : null}
        <div className="room-list" role="list">
          {rooms.length === 0 ? (
            <p className="muted small room-empty">{t("rooms.none")}</p>
          ) : null}
          {rooms.map((entry) => (
            <button
              key={entry.room.roomId}
              type="button"
              role="listitem"
              className={`room-list-item${entry.room.roomId === selected ? " is-selected" : ""}`}
              onClick={() => setSelected(entry.room.roomId)}
            >
              <span className="room-list-name">#{entry.room.name}</span>
              <span className="room-list-meta">
                <span className={`room-kind kind-${entry.room.kind}`}>
                  {t(`rooms.kind.${entry.room.kind}`)}
                </span>
                {entry.room.repoName ? (
                  <span className="muted small">{entry.room.repoName}</span>
                ) : null}
                {entry.unread > 0 ? (
                  <span className="room-unread">{entry.unread}</span>
                ) : null}
              </span>
              <span className="muted small">
                {entry.lastSeq === 0
                  ? t("rooms.noEvents")
                  : `#${entry.lastSeq}`}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="room-chat">
        {selectedRoom && snapshot ? (
          <>
            <header className="room-chat-head">
              <div>
                <h3>#{selectedRoom.name}</h3>
                <p className="muted small">
                  {t("rooms.memberCount", { count: contacts.length })} ·{" "}
                  {t(`rooms.kind.${selectedRoom.kind}`)}
                </p>
              </div>
              <div className="room-chat-actions">
                <button
                  type="button"
                  className="btn small outline"
                  onClick={() => setMemberOpen((value) => !value)}
                >
                  {t("rooms.addMember")}
                </button>
                <button
                  type="button"
                  className="btn small outline"
                  disabled={
                    !snapshot.rounds.some((round) => round.status === "open")
                  }
                  onClick={() => void stopRound()}
                >
                  {t("rooms.stopRound")}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void loadSelected(selectedRoom.roomId)}
                  aria-label={t("rooms.refresh")}
                  data-tip={t("rooms.refresh")}
                >
                  <Icon name="refresh" />
                </button>
              </div>
            </header>
            {memberOpen ? (
              <div className="room-form room-member-form">
                <input
                  value={memberId}
                  onChange={(event) => setMemberId(event.target.value)}
                  placeholder={t("rooms.memberId")}
                  aria-label={t("rooms.memberId")}
                />
                <input
                  value={memberName}
                  onChange={(event) => setMemberName(event.target.value)}
                  placeholder={t("rooms.memberName")}
                  aria-label={t("rooms.memberName")}
                />
                <select
                  value={memberRole}
                  onChange={(event) =>
                    setMemberRole(event.target.value as LocalRoomMemberRole)
                  }
                  aria-label={t("rooms.memberRole")}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`rooms.role.${role}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn small"
                  disabled={busy || !memberId.trim()}
                  onClick={() => void addMember()}
                >
                  {t("rooms.addMember")}
                </button>
              </div>
            ) : null}
            <div className="room-contacts">
              {contacts.map((member) => (
                <div key={member.memberId} className="room-contact">
                  <span
                    className={statusClass(member.status)}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="room-contact-name"
                    onClick={() => insertMention(member)}
                    title={t("rooms.mention")}
                  >
                    {member.displayName}
                  </button>
                  <span className="room-chip">
                    {t(`rooms.role.${member.role}`)}
                  </span>
                  {member.repoName ? (
                    <span className="muted small">{member.repoName}</span>
                  ) : null}
                  {member.role === "resident" ? (
                    member.status === "parked" ? (
                      <button
                        type="button"
                        className="btn tiny outline"
                        onClick={() => void resident(member, "revive")}
                      >
                        {t("rooms.revive")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn tiny outline"
                        onClick={() => void resident(member, "park")}
                      >
                        {t("rooms.park")}
                      </button>
                    )
                  ) : null}
                </div>
              ))}
            </div>
            <div className="room-log">
              {snapshot.events.length === 0 ? (
                <p className="muted small room-empty">{t("rooms.noEvents")}</p>
              ) : null}
              {snapshot.events.map((event: LocalRoomEventReadModel) => (
                <article
                  key={event.eventId}
                  className={`room-event actor-${event.actor.kind}`}
                >
                  <header>
                    <span className="room-seq">#{event.seq}</span>
                    <span className="room-sender">{event.actor.name}</span>
                    <span className="muted small">
                      {formatTime(event.sentAt, resolvedLanguage)}
                    </span>
                    {event.replyTo !== undefined ? (
                      <span className="room-reply-chip">
                        {t("rooms.replyTo", { seq: event.replyTo })}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="icon-btn tiny"
                      onClick={() => setReplyTo(event.seq)}
                      aria-label={t("rooms.quote")}
                      data-tip={t("rooms.quote")}
                    >
                      <Icon name="fork" />
                    </button>
                  </header>
                  <p>{event.body}</p>
                  {event.mentions.length > 0 ? (
                    <p className="room-mentions">
                      {event.mentions.map((value) => `@${value}`).join(" ")}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
            <footer className="room-composer">
              {replyTo !== undefined ? (
                <div className="room-reply-banner">
                  <span>{t("rooms.replyingTo", { seq: replyTo })}</span>
                  <button
                    type="button"
                    className="icon-btn tiny"
                    onClick={() => setReplyTo(undefined)}
                    aria-label={t("rooms.cancelReply")}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("rooms.placeholder")}
                aria-label={t("rooms.placeholder")}
                rows={3}
              />
              <div className="room-composer-actions">
                <div
                  className="room-modes"
                  role="group"
                  aria-label={t("rooms.modeLabel")}
                >
                  {MODES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`btn tiny${mode === value ? " primary" : " outline"}`}
                      onClick={() => setMode(value)}
                    >
                      {t(`rooms.mode.${value}`)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn small"
                  disabled={busy || !draft.trim()}
                  onClick={() => void send()}
                >
                  {t("rooms.send")}
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="room-empty">
            <Icon name="message" />
            <p className="muted">{t("rooms.select")}</p>
          </div>
        )}
        {error ? (
          <div className="banner amber" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="banner green" role="status">
            {notice}
          </div>
        ) : null}
      </section>
    </div>
  );
}
