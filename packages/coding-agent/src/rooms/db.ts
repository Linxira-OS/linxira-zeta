/**
 * Durable local room log.
 *
 * A room file is deliberately separate from the Team database and from every
 * session transcript. `seq` is assigned by this host inside one transaction, so
 * a room restart preserves order and a sender can never choose it. `sentAt` is
 * also host-assigned and strictly increases per room.
 */

import { Database } from "bun:sqlite";
import { getZetaDbPath } from "@linxiraos/pi-utils/dirs";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
	Room,
	RoomActor,
	RoomCursor,
	RoomDeliveryMode,
	RoomEvent,
	RoomEventKind,
	RoomKind,
	RoomMember,
	RoomMemberRole,
	RoomProposal,
	RoomProposalStatus,
	RoomRound,
	RoomRoundStatus,
	RoomRoundTarget,
	RoomTargetStatus,
} from "./types";

const MIGRATIONS: readonly string[] = [
	`
CREATE TABLE IF NOT EXISTS rooms (
	room_id      TEXT PRIMARY KEY,
	kind         TEXT NOT NULL CHECK (kind IN ('super', 'repo', 'main')),
	name         TEXT NOT NULL,
	repo_root    TEXT,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
	room_id         TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	member_id       TEXT NOT NULL,
	role            TEXT NOT NULL CHECK (role IN ('super', 'repo', 'main', 'resident')),
	display_name    TEXT NOT NULL,
	repo_root       TEXT,
	home_session_id TEXT,
	created_at      INTEGER NOT NULL,
	PRIMARY KEY (room_id, member_id)
);

CREATE TABLE IF NOT EXISTS room_events (
	room_id        TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	seq            INTEGER NOT NULL,
	event_id       TEXT NOT NULL UNIQUE,
	kind           TEXT NOT NULL,
	actor_kind     TEXT NOT NULL CHECK (actor_kind IN ('user', 'agent', 'system')),
	actor_id       TEXT NOT NULL,
	actor_name     TEXT NOT NULL,
	sent_at        INTEGER NOT NULL,
	body           TEXT NOT NULL,
	reply_to       INTEGER,
	mentions_json  TEXT NOT NULL DEFAULT '[]',
	round_id       TEXT,
	status         TEXT,
	PRIMARY KEY (room_id, seq),
	FOREIGN KEY (room_id, reply_to) REFERENCES room_events(room_id, seq) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS room_cursors (
	room_id              TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	member_id            TEXT NOT NULL,
	seen_through_seq     INTEGER NOT NULL DEFAULT 0,
	delivered_through_seq INTEGER NOT NULL DEFAULT 0,
	read_through_seq     INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (room_id, member_id)
);

CREATE TABLE IF NOT EXISTS room_rounds (
	round_id     TEXT PRIMARY KEY,
	room_id      TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	trigger_seq  INTEGER NOT NULL,
	mode         TEXT NOT NULL CHECK (mode IN ('parallel', 'serial', 'mention')),
	status       TEXT NOT NULL CHECK (status IN ('open', 'done', 'stopped')),
	created_at   INTEGER NOT NULL,
	completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS room_round_targets (
	round_id     TEXT NOT NULL REFERENCES room_rounds(round_id) ON DELETE CASCADE,
	room_id      TEXT NOT NULL,
	member_id    TEXT NOT NULL,
	status       TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'replied', 'passed', 'failed')),
	delivered_seq INTEGER,
	replied_seq   INTEGER,
	PRIMARY KEY (round_id, member_id)
);

CREATE TABLE IF NOT EXISTS room_proposals (
	proposal_id      TEXT PRIMARY KEY,
	room_id          TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	seq              INTEGER NOT NULL,
	target_repo      TEXT NOT NULL,
	target_member_id TEXT,
	decision_id      TEXT,
	status           TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'rejected', 'stale')),
	created_at       INTEGER NOT NULL,
	resolved_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_room_members_member ON room_members(member_id);
CREATE INDEX IF NOT EXISTS idx_room_events_room_seq ON room_events(room_id, seq);
CREATE INDEX IF NOT EXISTS idx_room_round_targets_member ON room_round_targets(room_id, member_id);
CREATE INDEX IF NOT EXISTS idx_room_proposals_room ON room_proposals(room_id, seq);
`,
];

export function resolveRoomsDbPath(): string {
	const override = process.env.ZETA_ROOMS_DB?.trim();
	return override ? path.resolve(override) : path.join(path.dirname(getZetaDbPath()), "rooms.db");
}

interface DbRoomRow {
	room_id: string;
	kind: RoomKind;
	name: string;
	repo_root: string | null;
	created_at: number;
	updated_at: number;
}

interface DbMemberRow {
	room_id: string;
	member_id: string;
	role: RoomMemberRole;
	display_name: string;
	repo_root: string | null;
	home_session_id: string | null;
	created_at: number;
}

interface DbEventRow {
	room_id: string;
	seq: number;
	event_id: string;
	kind: RoomEventKind;
	actor_kind: "user" | "agent" | "system";
	actor_id: string;
	actor_name: string;
	sent_at: number;
	body: string;
	reply_to: number | null;
	mentions_json: string;
	round_id: string | null;
	status: RoomTargetStatus | null;
}

interface DbCursorRow {
	room_id: string;
	member_id: string;
	seen_through_seq: number;
	delivered_through_seq: number;
	read_through_seq: number;
}

interface DbRoundRow {
	round_id: string;
	room_id: string;
	trigger_seq: number;
	mode: RoomDeliveryMode;
	status: RoomRoundStatus;
	created_at: number;
	completed_at: number | null;
}

interface DbRoundTargetRow {
	round_id: string;
	room_id: string;
	member_id: string;
	status: RoomTargetStatus;
	delivered_seq: number | null;
	replied_seq: number | null;
}

interface DbProposalRow {
	proposal_id: string;
	room_id: string;
	seq: number;
	target_repo: string;
	target_member_id: string | null;
	decision_id: string | null;
	status: RoomProposalStatus;
	created_at: number;
	resolved_at: number | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

function parseMentions(raw: string): string[] {
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function toRoom(row: DbRoomRow): Room {
	return {
		id: row.room_id,
		kind: row.kind,
		name: row.name,
		...(row.repo_root === null ? {} : { repoRoot: row.repo_root }),
		createdAt: iso(row.created_at),
		updatedAt: iso(row.updated_at),
	};
}

function toMember(row: DbMemberRow): RoomMember {
	return {
		roomId: row.room_id,
		memberId: row.member_id,
		role: row.role,
		displayName: row.display_name,
		...(row.repo_root === null ? {} : { repoRoot: row.repo_root }),
		...(row.home_session_id === null ? {} : { homeSessionId: row.home_session_id }),
		createdAt: iso(row.created_at),
	};
}

function toEvent(row: DbEventRow): RoomEvent {
	const actor: RoomActor = { kind: row.actor_kind, id: row.actor_id, name: row.actor_name };
	return {
		roomId: row.room_id,
		seq: row.seq,
		eventId: row.event_id,
		kind: row.kind,
		actor,
		sentAt: iso(row.sent_at),
		body: row.body,
		...(row.reply_to === null ? {} : { replyTo: row.reply_to }),
		mentions: parseMentions(row.mentions_json),
		...(row.round_id === null ? {} : { roundId: row.round_id }),
		...(row.status === null ? {} : { status: row.status }),
	};
}

function toCursor(row: DbCursorRow): RoomCursor {
	return {
		roomId: row.room_id,
		memberId: row.member_id,
		seenThroughSeq: row.seen_through_seq,
		deliveredThroughSeq: row.delivered_through_seq,
		readThroughSeq: row.read_through_seq,
	};
}

function toRound(row: DbRoundRow): RoomRound {
	return {
		roundId: row.round_id,
		roomId: row.room_id,
		triggerSeq: row.trigger_seq,
		mode: row.mode,
		status: row.status,
		createdAt: iso(row.created_at),
		...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
	};
}

function toTarget(row: DbRoundTargetRow): RoomRoundTarget {
	return {
		roundId: row.round_id,
		roomId: row.room_id,
		memberId: row.member_id,
		status: row.status,
		...(row.delivered_seq === null ? {} : { deliveredSeq: row.delivered_seq }),
		...(row.replied_seq === null ? {} : { repliedSeq: row.replied_seq }),
	};
}

function toProposal(row: DbProposalRow): RoomProposal {
	return {
		proposalId: row.proposal_id,
		roomId: row.room_id,
		seq: row.seq,
		targetRepo: row.target_repo,
		...(row.target_member_id === null ? {} : { targetMemberId: row.target_member_id }),
		...(row.decision_id === null ? {} : { decisionId: row.decision_id }),
		status: row.status,
		createdAt: iso(row.created_at),
		...(row.resolved_at === null ? {} : { resolvedAt: iso(row.resolved_at) }),
	};
}

export interface AppendEventInput {
	roomId: string;
	kind: RoomEventKind;
	actor: RoomActor;
	body: string;
	replyTo?: number;
	mentions?: readonly string[];
	roundId?: string;
	status?: RoomTargetStatus;
}

export interface CreateRoomRecord {
	id: string;
	kind: RoomKind;
	name: string;
	repoRoot?: string;
}

/** One open connection to the durable local room log. */
export class RoomLog {
	#db: Database;

	constructor(dbPath: string = resolveRoomsDbPath()) {
		fs.mkdirSync(path.dirname(dbPath), { recursive: true });
		this.#db = new Database(dbPath);
		this.#db.run("PRAGMA busy_timeout = 5000");
		this.#db.run("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;");
		this.#migrate();
	}

	close(): void {
		this.#db.close();
	}

	#migrate(): void {
		const row = this.#db.query("PRAGMA user_version").get() as { user_version: number } | null;
		const current = row?.user_version ?? 0;
		for (let version = current; version < MIGRATIONS.length; version++) {
			this.#db.transaction(() => {
				this.#db.run(MIGRATIONS[version]);
				this.#db.run(`PRAGMA user_version = ${version + 1}`);
			})();
		}
	}

	// ── rooms ─────────────────────────────────────────────────────────────

	listRooms(): Room[] {
		return this.#db.query<DbRoomRow, []>("SELECT * FROM rooms ORDER BY updated_at DESC, name").all().map(toRoom);
	}

	getRoom(roomId: string): Room | null {
		const row = this.#db.query<DbRoomRow, [string]>("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
		return row ? toRoom(row) : null;
	}

	findRoom(kind: RoomKind, name: string, repoRoot: string | null): Room | null {
		const row = this.#db
			.query<DbRoomRow, [string, string, string | null]>(
				"SELECT * FROM rooms WHERE kind = ? AND name = ? AND repo_root IS ?",
			)
			.get(kind, name, repoRoot);
		return row ? toRoom(row) : null;
	}

	insertRoom(record: CreateRoomRecord): Room {
		const now = Date.now();
		const room: Room = {
			id: record.id,
			kind: record.kind,
			name: record.name,
			...(record.repoRoot === undefined ? {} : { repoRoot: record.repoRoot }),
			createdAt: iso(now),
			updatedAt: iso(now),
		};
		this.#db
			.query("INSERT INTO rooms (room_id, kind, name, repo_root, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
			.run(room.id, room.kind, room.name, record.repoRoot ?? null, now, now);
		return room;
	}

	touchRoom(roomId: string): void {
		this.#db.query("UPDATE rooms SET updated_at = ? WHERE room_id = ?").run(Date.now(), roomId);
	}

	deleteRoom(roomId: string): void {
		this.#db.query("DELETE FROM rooms WHERE room_id = ?").run(roomId);
	}

	// ── members ───────────────────────────────────────────────────────────

	listMembers(roomId: string): RoomMember[] {
		return this.#db
			.query<DbMemberRow, [string]>("SELECT * FROM room_members WHERE room_id = ? ORDER BY role, display_name")
			.all(roomId)
			.map(toMember);
	}

	getMember(roomId: string, memberId: string): RoomMember | null {
		const row = this.#db
			.query<DbMemberRow, [string, string]>("SELECT * FROM room_members WHERE room_id = ? AND member_id = ?")
			.get(roomId, memberId);
		return row ? toMember(row) : null;
	}

	insertMember(member: Omit<RoomMember, "createdAt">): RoomMember {
		const now = Date.now();
		this.#db
			.query(
				`INSERT INTO room_members
				 (room_id, member_id, role, display_name, repo_root, home_session_id, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				member.roomId,
				member.memberId,
				member.role,
				member.displayName,
				member.repoRoot ?? null,
				member.homeSessionId ?? null,
				now,
			);
		return { ...member, createdAt: iso(now) };
	}

	deleteMember(roomId: string, memberId: string): void {
		this.#db.query("DELETE FROM room_members WHERE room_id = ? AND member_id = ?").run(roomId, memberId);
		this.#db.query("DELETE FROM room_cursors WHERE room_id = ? AND member_id = ?").run(roomId, memberId);
	}

	// ── ordered events ────────────────────────────────────────────────────

	/** Append one event and return it with the host-assigned `seq` and `sentAt`. */
	appendEvent(input: AppendEventInput): RoomEvent {
		return this.#db.transaction(() => {
			const last = this.#db
				.query<{ seq: number; sent_at: number }, [string]>(
					"SELECT COALESCE(MAX(seq), 0) AS seq, COALESCE(MAX(sent_at), 0) AS sent_at FROM room_events WHERE room_id = ?",
				)
				.get(input.roomId);
			const seq = (last?.seq ?? 0) + 1;
			// Strictly increasing even when two posts land in the same millisecond.
			const sentAt = Math.max(Date.now(), (last?.sent_at ?? 0) + 1);
			const eventId = `ev_${randomUUID()}`;
			const mentions = input.mentions ?? [];
			this.#db
				.query(
					`INSERT INTO room_events
					 (room_id, seq, event_id, kind, actor_kind, actor_id, actor_name, sent_at, body, reply_to, mentions_json, round_id, status)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					input.roomId,
					seq,
					eventId,
					input.kind,
					input.actor.kind,
					input.actor.id,
					input.actor.name,
					sentAt,
					input.body,
					input.replyTo ?? null,
					JSON.stringify(mentions),
					input.roundId ?? null,
					input.status ?? null,
				);
			this.touchRoom(input.roomId);
			return {
				roomId: input.roomId,
				seq,
				eventId,
				kind: input.kind,
				actor: input.actor,
				sentAt: iso(sentAt),
				body: input.body,
				...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
				mentions,
				...(input.roundId === undefined ? {} : { roundId: input.roundId }),
				...(input.status === undefined ? {} : { status: input.status }),
			};
		})();
	}

	listEvents(roomId: string, options: { afterSeq?: number; beforeSeq?: number; limit?: number } = {}): RoomEvent[] {
		const where = ["room_id = ?"];
		const params: Array<string | number> = [roomId];
		if (options.afterSeq !== undefined) {
			where.push("seq > ?");
			params.push(options.afterSeq);
		}
		if (options.beforeSeq !== undefined) {
			where.push("seq < ?");
			params.push(options.beforeSeq);
		}
		const limit = options.limit;
		const sql =
			limit === undefined
				? `SELECT * FROM room_events WHERE ${where.join(" AND ")} ORDER BY seq`
				: `SELECT * FROM room_events WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ?`;
		const rows = this.#db
			.query<DbEventRow, Array<string | number>>(sql)
			.all(...(limit === undefined ? params : [...params, limit]));
		return (limit === undefined ? rows : rows.reverse()).map(toEvent);
	}

	attachEventRound(roomId: string, seq: number, roundId: string): void {
		this.#db.query("UPDATE room_events SET round_id = ? WHERE room_id = ? AND seq = ?").run(roundId, roomId, seq);
	}

	getEvent(roomId: string, seq: number): RoomEvent | null {
		const row = this.#db
			.query<DbEventRow, [string, number]>("SELECT * FROM room_events WHERE room_id = ? AND seq = ?")
			.get(roomId, seq);
		return row ? toEvent(row) : null;
	}

	lastEvent(roomId: string): RoomEvent | null {
		const row = this.#db
			.query<DbEventRow, [string]>("SELECT * FROM room_events WHERE room_id = ? ORDER BY seq DESC LIMIT 1")
			.get(roomId);
		return row ? toEvent(row) : null;
	}

	// ── cursors ───────────────────────────────────────────────────────────

	getCursor(roomId: string, memberId: string): RoomCursor {
		this.#db.query("INSERT OR IGNORE INTO room_cursors (room_id, member_id) VALUES (?, ?)").run(roomId, memberId);
		const row = this.#db
			.query<DbCursorRow, [string, string]>("SELECT * FROM room_cursors WHERE room_id = ? AND member_id = ?")
			.get(roomId, memberId);
		if (!row) throw new Error("room cursor insert did not persist");
		return toCursor(row);
	}

	advanceCursor(
		roomId: string,
		memberId: string,
		field: "seen_through_seq" | "delivered_through_seq" | "read_through_seq",
		seq: number,
	): boolean {
		this.#db.query("INSERT OR IGNORE INTO room_cursors (room_id, member_id) VALUES (?, ?)").run(roomId, memberId);
		return (
			this.#db
				.query(`UPDATE room_cursors SET ${field} = ? WHERE room_id = ? AND member_id = ? AND ${field} < ?`)
				.run(seq, roomId, memberId, seq).changes === 1
		);
	}

	// ── rounds (delivery bookkeeping, not a task scheduler) ───────────────

	createRound(roomId: string, triggerSeq: number, mode: RoomDeliveryMode, memberIds: readonly string[]): RoomRound {
		const roundId = `rd_${randomUUID()}`;
		const now = Date.now();
		this.#db.transaction(() => {
			this.#db
				.query(
					"INSERT INTO room_rounds (round_id, room_id, trigger_seq, mode, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
				)
				.run(roundId, roomId, triggerSeq, mode, now);
			for (const memberId of memberIds) {
				this.#db
					.query(
						"INSERT INTO room_round_targets (round_id, room_id, member_id, status) VALUES (?, ?, ?, 'pending')",
					)
					.run(roundId, roomId, memberId);
			}
		})();
		return { roundId, roomId, triggerSeq, mode, status: "open", createdAt: iso(now) };
	}

	getRound(roundId: string): RoomRound | null {
		const row = this.#db.query<DbRoundRow, [string]>("SELECT * FROM room_rounds WHERE round_id = ?").get(roundId);
		return row ? toRound(row) : null;
	}

	listRounds(roomId: string): RoomRound[] {
		return this.#db
			.query<DbRoundRow, [string]>("SELECT * FROM room_rounds WHERE room_id = ? ORDER BY created_at DESC")
			.all(roomId)
			.map(toRound);
	}

	listRoundTargets(roundId: string): RoomRoundTarget[] {
		return this.#db
			.query<DbRoundTargetRow, [string]>("SELECT * FROM room_round_targets WHERE round_id = ? ORDER BY member_id")
			.all(roundId)
			.map(toTarget);
	}

	getRoundTarget(roundId: string, memberId: string): RoomRoundTarget | null {
		const row = this.#db
			.query<DbRoundTargetRow, [string, string]>(
				"SELECT * FROM room_round_targets WHERE round_id = ? AND member_id = ?",
			)
			.get(roundId, memberId);
		return row ? toTarget(row) : null;
	}

	setTargetStatus(
		roundId: string,
		memberId: string,
		status: RoomTargetStatus,
		fields: { deliveredSeq?: number; repliedSeq?: number } = {},
	): boolean {
		const changed = this.#db
			.query(
				`UPDATE room_round_targets
				 SET status = ?,
				     delivered_seq = COALESCE(?, delivered_seq),
				     replied_seq = COALESCE(?, replied_seq)
				 WHERE round_id = ? AND member_id = ?`,
			)
			.run(status, fields.deliveredSeq ?? null, fields.repliedSeq ?? null, roundId, memberId);
		return changed.changes === 1;
	}

	setRoundStatus(roundId: string, status: RoomRoundStatus): void {
		this.#db
			.query("UPDATE room_rounds SET status = ?, completed_at = ? WHERE round_id = ?")
			.run(status, status === "open" ? null : Date.now(), roundId);
	}

	// ── proposals (log-only until the target accepts) ─────────────────────

	insertProposal(proposal: Omit<RoomProposal, "createdAt" | "status">): RoomProposal {
		const now = Date.now();
		this.#db
			.query(
				`INSERT INTO room_proposals
				 (proposal_id, room_id, seq, target_repo, target_member_id, decision_id, status, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
			)
			.run(
				proposal.proposalId,
				proposal.roomId,
				proposal.seq,
				proposal.targetRepo,
				proposal.targetMemberId ?? null,
				proposal.decisionId ?? null,
				now,
			);
		return { ...proposal, status: "open", createdAt: iso(now) };
	}

	getProposal(proposalId: string): RoomProposal | null {
		const row = this.#db
			.query<DbProposalRow, [string]>("SELECT * FROM room_proposals WHERE proposal_id = ?")
			.get(proposalId);
		return row ? toProposal(row) : null;
	}

	resolveProposal(
		proposalId: string,
		status: Exclude<RoomProposalStatus, "open">,
		decisionId?: string,
	): RoomProposal | null {
		this.#db
			.query(
				"UPDATE room_proposals SET status = ?, resolved_at = ?, decision_id = COALESCE(?, decision_id) WHERE proposal_id = ?",
			)
			.run(status, Date.now(), decisionId ?? null, proposalId);
		return this.getProposal(proposalId);
	}
}
