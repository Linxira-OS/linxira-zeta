import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "./team.css";

type TeamView = "team" | "channels";
type TeamTab = "chat" | "board" | "calendar" | "channels" | "settings";

const TEAM_INTENT_KEY = "zeta.studio.teamIntent";
const TEAM_INTENT_EVENT = "zeta:team-intent";

/**
 * Ask the Team surface to open on one of its internal modes.
 *
 * The bottom-left menu calls this before routing so a click lands in Channels,
 * and the dispatched event switches an already-open Team surface in place.
 */
export function setTeamIntent(view: TeamView): void {
	try {
		sessionStorage.setItem(TEAM_INTENT_KEY, view);
	} catch {
		/* sessionStorage may be blocked; navigation still opens the page. */
	}
	window.dispatchEvent(new CustomEvent<TeamView>(TEAM_INTENT_EVENT, { detail: view }));
}

function takeTeamIntent(): TeamView | null {
	try {
		const raw = sessionStorage.getItem(TEAM_INTENT_KEY);
		if (raw === null) return null;
		sessionStorage.removeItem(TEAM_INTENT_KEY);
		return raw === "channels" ? "channels" : "team";
	} catch {
		return null;
	}
}
type Address = "room" | "one" | "all";
type Member = {
	id: string;
	name: string;
	role: string;
	color: string;
	status: "running" | "idle" | "review";
	digest: string;
};

const ME: Member = {
	id: "me",
	name: "You",
	role: "operator",
	color: "#2563eb",
	status: "idle",
	digest: "Watching the room",
};

const MEMBERS: Member[] = [
	{ id: "mira", name: "Mira", role: "PM", color: "#4f8cff", status: "running", digest: "Reviewing the auth rollout plan and the 1.4.12 gate." },
	{ id: "kai", name: "Kai", role: "Engineer", color: "#22c55e", status: "running", digest: "Implementing the session digest envelope on the release branch." },
	{ id: "nova", name: "Nova", role: "Reviewer", color: "#f59e0b", status: "review", digest: "Reviewing Kai's diff; one blocker on queue ordering." },
	{ id: "rin", name: "Rin", role: "Engineer", color: "#ec4899", status: "idle", digest: "Waiting for the compact-plan handoff." },
	{ id: "sable", name: "Sable", role: "Boss", color: "#14b8a6", status: "idle", digest: "Monitoring cross-repo requests and team budget." },
];

type Message = {
	id: string;
	author: string;
	text: string;
	time: string;
	to?: string[];
	cc?: string[];
	delivery?: "inserted" | "queued" | "steered";
	reactions: Record<string, number>;
};

const INITIAL_MESSAGES: Message[] = [
	{
		id: "m1",
		author: "mira",
		text: "Plan is ready for review. It keeps the current session, no compaction, and the queue stays intact.",
		time: "10:38",
		to: ["kai"],
		cc: ["nova"],
		delivery: "inserted",
		reactions: { "👍": 2, "👀": 3 },
	},
	{
		id: "m2",
		author: "kai",
		text: "Reviewed the checkpoint report. The diff is clean; the only open item is the digest redaction test.",
		time: "10:41",
		reactions: { "🔥": 1, "👍": 1 },
	},
	{
		id: "m3",
		author: "nova",
		text: "I would keep the review gate pending until the last tool batch lands. The TUI timer still needs the same gate.",
		time: "10:42",
		to: ["mira", "kai"],
		reactions: { "⚠️": 2 },
	},
	{
		id: "m4",
		author: "mira",
		text: "Agreed. Pass the turn to Kai after the next boundary; Rin stays queued for the compact handoff.",
		time: "10:43",
		to: ["kai"],
		cc: ["rin"],
		delivery: "queued",
		reactions: {},
	},
];

type Card = {
	id: string;
	title: string;
	owner: string;
	repo: string;
	progress: number;
	state: "Backlog" | "In progress" | "Review" | "Done";
	tags: string[];
	note: string;
};

const INITIAL_BOARD: Card[] = [
	{ id: "t1", title: "Session digest envelope", owner: "kai", repo: "zeta/core", progress: 72, state: "In progress", tags: ["team", "digest"], note: "Latest recap + current task in the cross-repo envelope." },
	{ id: "t2", title: "Queue coalescing at step boundary", owner: "nova", repo: "zeta/core", progress: 58, state: "Review", tags: ["queue", "cache"], note: "Original text, sender, and timestamp must survive." },
	{ id: "t3", title: "Checkpoint report gate", owner: "rin", repo: "zeta/core", progress: 35, state: "Backlog", tags: ["goal", "review"], note: "Engineer report pauses continuation until PM verdict." },
	{ id: "t4", title: "Remote device pairing", owner: "sable", repo: "zeta/web", progress: 91, state: "Review", tags: ["remote", "auth"], note: "QR + two six-digit confirmations; no recovery code." },
	{ id: "t5", title: "Studio Team prototype", owner: "you", repo: "zeta/web-app", progress: 64, state: "In progress", tags: ["ui", "prototype"], note: "Modern, responsive, non-destructive page in Studio." },
	{ id: "t6", title: "OMP v18.18.0 gate", owner: "mira", repo: "zeta/upstream", progress: 18, state: "Backlog", tags: ["merge", "gate"], note: "Partial-clone fetch must complete before true merge." },
];

type CalendarEvent = {
	id: string;
	day: string;
	time: string;
	title: string;
	kind: "review" | "handoff" | "sync";
	owner: string;
};

const CALENDAR: CalendarEvent[] = [
	{ id: "c1", day: "Mon", time: "09:30", title: "Plan review · auth rollout", kind: "review", owner: "mira" },
	{ id: "c2", day: "Mon", time: "11:00", title: "Queue gate sync", kind: "sync", owner: "nova" },
	{ id: "c3", day: "Tue", time: "10:00", title: "Fresh handoff · Rin", kind: "handoff", owner: "kai" },
	{ id: "c4", day: "Wed", time: "14:30", title: "Release 1.4.12 gate", kind: "review", owner: "sable" },
	{ id: "c5", day: "Thu", time: "10:00", title: "Team prototype review", kind: "review", owner: "you" },
	{ id: "c6", day: "Fri", time: "16:00", title: "Weekly digest / cost", kind: "sync", owner: "mira" },
];

type Settings = {
	remote: boolean;
	totp: boolean;
	trustLan: boolean;
	vibeBoss: boolean;
	vibePm: boolean;
	pmGoal: boolean;
	pmLoop: boolean;
	coalesce: boolean;
};

const INITIAL_SETTINGS: Settings = {
	remote: true,
	totp: true,
	trustLan: false,
	vibeBoss: false,
	vibePm: false,
	pmGoal: false,
	pmLoop: false,
	coalesce: true,
};

const EMOJIS = ["👍", "🔥", "👀", "⚠️"];

function memberById(id: string): Member {
	return id === ME.id ? ME : MEMBERS.find((member) => member.id === id) ?? MEMBERS[0]!;
}

function Avatar({ member, size = 34 }: { member: Member; size?: number }) {
	return (
		<span
			className="tp-avatar"
			style={{ width: size, height: size, background: `linear-gradient(145deg, ${member.color}, color-mix(in srgb, ${member.color} 42%, #111))` }}
			title={`${member.name} · ${member.role}`}
		>
			{member.name.slice(0, 1)}
		</span>
	);
}

function StatusDot({ status }: { status: Member["status"] }) {
	return <span className={`tp-status-dot ${status}`} aria-label={status} />;
}

function ReactionBar({ message, onReact }: { message: Message; onReact: (id: string, emoji: string) => void }) {
	return (
		<div className="tp-reactions">
			{EMOJIS.map((emoji) => {
				const count = message.reactions[emoji] ?? 0;
				return (
					<button
						key={emoji}
						type="button"
						className={`tp-reaction${count > 0 ? " active" : ""}`}
						onClick={() => onReact(message.id, emoji)}
						aria-label={`React ${emoji}`}
					>
						<span>{emoji}</span>
						{count > 0 ? <b>{count}</b> : null}
					</button>
				);
			})}
			<button type="button" className="tp-reaction tp-reaction-more" onClick={() => onReact(message.id, "👀")} aria-label="More reactions">
				<Icon name="plus" extra="sm" />
			</button>
		</div>
	);
}

function MessageRow({ message, onReact }: { message: Message; onReact: (id: string, emoji: string) => void }) {
	const author = memberById(message.author);
	const isMe = author.id === ME.id;
	return (
		<article className={`tp-message${isMe ? " me" : ""}`}>
			<Avatar member={author} size={36} />
			<div className="tp-message-body">
				<header>
					<b>{author.name}</b>
					<span className="tp-role">{author.role}</span>
					<span className="tp-time">{message.time}</span>
					{message.delivery ? <span className={`tp-delivery ${message.delivery}`}>{message.delivery}</span> : null}
				</header>
				<p>{message.text}</p>
				{message.to?.length || message.cc?.length ? (
					<div className="tp-recipients">
						{message.to?.map((id) => <span key={`to-${id}`} className="tp-chip to">@{memberById(id).name}</span>)}
						{message.cc?.map((id) => <span key={`cc-${id}`} className="tp-chip cc">cc {memberById(id).name}</span>)}
					</div>
				) : null}
				<ReactionBar message={message} onReact={onReact} />
			</div>
		</article>
	);
}

function ChatView({
	messages,
	onReact,
	onSend,
	draft,
	setDraft,
	address,
	setAddress,
	mention,
	setMention,
	filter,
	setFilter,
}: {
	messages: Message[];
	onReact: (id: string, emoji: string) => void;
	onSend: () => void;
	draft: string;
	setDraft: (value: string) => void;
	address: Address;
	setAddress: (value: Address) => void;
	mention: string;
	setMention: (value: string) => void;
	filter: string;
	setFilter: (value: string) => void;
}) {
	const visible = useMemo(() => {
		const query = filter.trim().toLowerCase();
		if (!query) return messages;
		return messages.filter((message) => message.text.toLowerCase().includes(query) || memberById(message.author).name.toLowerCase().includes(query));
	}, [filter, messages]);
	const timelineRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const node = timelineRef.current;
		if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
	}, [messages.length]);

	return (
		<>
			<div className="tp-room-head">
				<div>
					<div className="tp-room-title">
						<span className="tp-room-mark"><Icon name="message" /></span>
						<div>
							<h2># general</h2>
							<p>6 members · Team room · live</p>
						</div>
					</div>
				</div>
				<div className="tp-room-tools">
					<label className="tp-search">
						<Icon name="search" extra="sm" />
						<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search room" aria-label="Search room" />
					</label>
					<button type="button" className="tp-icon-button" aria-label="Room details"><Icon name="info" /></button>
				</div>
			</div>
			<div className="tp-timeline" ref={timelineRef}>
				<div className="tp-dayline"><span>Today</span></div>
				{visible.map((message) => <MessageRow key={message.id} message={message} onReact={onReact} />)}
			</div>
			<div className="tp-composer">
				<div className="tp-composer-top">
					<div className="tp-address" role="group" aria-label="Message addressing">
						<button type="button" className={address === "room" ? "active" : ""} onClick={() => setAddress("room")}>Room</button>
						<button type="button" className={address === "one" ? "active" : ""} onClick={() => setAddress("one")}>@one</button>
						<button type="button" className={address === "all" ? "active" : ""} onClick={() => setAddress("all")}>@all</button>
					</div>
					{address !== "room" ? (
						<select aria-label="Mention" value={mention} onChange={(event) => setMention(event.target.value)}>
							{MEMBERS.filter((member) => member.id !== ME.id).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
						</select>
					) : null}
					<span className="tp-composer-hint">Enter to send · queue coalesces at the next step</span>
				</div>
				<div className="tp-composer-box">
					<textarea
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								onSend();
							}
						}}
						placeholder={address === "room" ? "Message the room…" : address === "one" ? `Message @${memberById(mention).name}…` : "Address the current room…"}
						rows={2}
					/>
					<div className="tp-composer-actions">
						<button type="button" className="tp-icon-button" onClick={() => setDraft(`${draft}@`)} aria-label="Mention"><Icon name="at" /></button>
						<button type="button" className="tp-icon-button" onClick={() => setDraft(`${draft} `)} aria-label="Insert space"><Icon name="slash" /></button>
						<button type="button" className="tp-send" onClick={onSend} disabled={!draft.trim()} aria-label="Send">
							<Icon name="send" /> Send
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

function BoardView({ cards, onOpen, onNew }: { cards: Card[]; onOpen: (id: string) => void; onNew: () => void }) {
	const columns: Card["state"][] = ["Backlog", "In progress", "Review", "Done"];
	return (
		<div className="tp-board">
			<div className="tp-board-head">
				<div>
					<h2>Board</h2>
					<p>Computed progress from checklist weights · manual override is visible</p>
				</div>
				<button type="button" className="tp-primary" onClick={onNew}><Icon name="plus" /> New task</button>
			</div>
			<div className="tp-columns">
				{columns.map((column) => {
					const items = cards.filter((card) => card.state === column);
					return (
						<section key={column} className="tp-column">
							<header><span>{column}</span><b>{items.length}</b></header>
							<div className="tp-column-body">
								{items.map((card) => (
									<button type="button" className="tp-task" key={card.id} onClick={() => onOpen(card.id)}>
										<div className="tp-task-top"><span className={`tp-priority ${card.tags[0] ?? "task"}`} /> <b>{card.title}</b></div>
										<div className="tp-task-meta"><span>{memberById(card.owner).name}</span><span>{card.repo}</span></div>
										<div className="tp-progress"><i style={{ width: `${card.progress}%` }} /></div>
										<div className="tp-task-foot"><span>{card.progress}%</span><span>{card.tags.join(" · ")}</span></div>
									</button>
								))}
								{items.length === 0 ? <p className="tp-empty">No cards</p> : null}
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
}

function CalendarView({ events }: { events: CalendarEvent[] }) {
	const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
	const [selected, setSelected] = useState(events[0]?.id ?? "");
	const [action, setAction] = useState("");
	return (
		<div className="tp-calendar">
			<div className="tp-board-head"><div><h2>Calendar</h2><p>Reviews, handoffs, and team syncs in one timeline</p></div><button type="button" className="tp-secondary" onClick={() => { setSelected(events[0]?.id ?? ""); setAction("Jumped to today"); }}><Icon name="clock" /> Today</button></div>
			<div className="tp-week">
				{days.map((day) => {
					const items = events.filter((event) => event.day === day);
					return (
						<section key={day} className="tp-day">
							<header><span>{day}</span><b>{items.length}</b></header>
							{items.map((event) => (
								<button type="button" key={event.id} className={`tp-event ${event.kind}${selected === event.id ? " active" : ""}`} onClick={() => { setSelected(event.id); setAction(""); }}>
									<span>{event.time}</span>
									<b>{event.title}</b>
									<small>{memberById(event.owner).name}</small>
								</button>
							))}
						</section>
					);
				})}
			</div>
			<div className="tp-calendar-detail">
				{(() => {
					const event = events.find((item) => item.id === selected);
					if (!event) return <p className="tp-empty">Select an event</p>;
					return (
						<>
							<span className={`tp-calendar-kind ${event.kind}`}>{event.kind}</span>
							<h3>{event.title}</h3>
							<p>{event.day} · {event.time} · owner {memberById(event.owner).name}</p>
							<div className="tp-calendar-actions">
								<button type="button" className="tp-primary" onClick={() => setAction("Marked ready")}><Icon name="check" /> Ready</button>
								<button type="button" className="tp-secondary" onClick={() => setAction("Reassigned to PM")}><Icon name="handoff" /> Reassign</button>
							</div>
							{action ? <p className="tp-note">{action}</p> : null}
						</>
					);
				})()}
			</div>
		</div>
	);
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
	return (
		<label className="tp-toggle-row">
			<span><b>{label}</b><small>{description}</small></span>
			<input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
		</label>
	);
}

function SettingsView({ settings, setSetting }: { settings: Settings; setSetting: (key: keyof Settings, value: boolean) => void }) {
	const [saved, setSaved] = useState(false);
	const [paired, setPaired] = useState(false);
	const [revoked, setRevoked] = useState(false);
	return (
		<div className="tp-settings">
			<div className="tp-board-head"><div><h2>Team settings</h2><p>Defaults shown here are team-scoped; the user can override them.</p></div><button type="button" className="tp-primary" onClick={() => setSaved(true)}><Icon name="save" /> {saved ? "Saved" : "Save changes"}</button></div>
			<div className="tp-settings-grid">
				<section className="tp-settings-card">
					<h3>Remote access</h3>
					<Toggle label="Enable remote" description="Browser and phone access through serve" checked={settings.remote} onChange={(value) => setSetting("remote", value)} />
					<Toggle label="TOTP 6/8 digits" description="Second factor after the two pairing codes" checked={settings.totp} onChange={(value) => setSetting("totp", value)} />
					<Toggle label="Trust LAN" description="Skip re-pairing on an explicit private network" checked={settings.trustLan} onChange={(value) => setSetting("trustLan", value)} />
					<div className="tp-devices">
						<div className="tp-device"><Icon name="phone" /><span><b>Pixel · Chrome</b><small>{revoked ? "Revoked" : "Trusted · last seen 2m ago"}</small></span><button type="button" onClick={() => setRevoked((value) => !value)}>{revoked ? "Restore" : "Revoke"}</button></div>
						{paired ? <div className="tp-device"><Icon name="tablet" /><span><b>Tablet · PWA</b><small>Trusted · just paired</small></span><button type="button" onClick={() => setPaired(false)}>Revoke</button></div> : null}
						<button type="button" className="tp-secondary" onClick={() => setPaired(true)}><Icon name="plus" /> Pair device</button>
						<p className="tp-note">First pair: QR + two six-digit confirmations. No recovery code.</p>
					</div>
				</section>
				<section className="tp-settings-card">
					<h3>Autonomy &amp; modes</h3>
					<Toggle label="Boss vibe" description="Default off; user or team policy must grant it" checked={settings.vibeBoss} onChange={(value) => setSetting("vibeBoss", value)} />
					<Toggle label="PM vibe" description="Default off; never grants autonomy to an engineer" checked={settings.vibePm} onChange={(value) => setSetting("vibePm", value)} />
					<Toggle label="PM may attach goal" description="Only bottom-level engineers execute it" checked={settings.pmGoal} onChange={(value) => setSetting("pmGoal", value)} />
					<Toggle label="PM may attach loop" description="Requires budget and checkpoint review" checked={settings.pmLoop} onChange={(value) => setSetting("pmLoop", value)} />
				</section>
				<section className="tp-settings-card">
					<h3>Delivery &amp; digest</h3>
					<Toggle label="Coalesce queued messages" description="Merge at the step boundary; preserve original text" checked={settings.coalesce} onChange={(value) => setSetting("coalesce", value)} />
					<div className="tp-setting-static"><b>Digest source</b><span>Latest session recap · bounded · redacted</span></div>
					<div className="tp-setting-static"><b>Plan defaults</b><span>plan / ultra allowed · preserve selected</span></div>
					<div className="tp-setting-static"><b>Handoff threshold</b><span>50 MB warning · no automatic rotation</span></div>
				</section>
				<section className="tp-settings-card">
					<h3>Reviewers</h3>
					<div className="tp-setting-static"><b>Engineer advisor</b><span>Advisor role · passive · separate model</span></div>
					<div className="tp-setting-static"><b>PM reviewer</b><span>Reviewer role · evidence and diff</span></div>
					<div className="tp-setting-static"><b>Auto-continue</b><span>Current model · structured judgment</span></div>
					<p className="tp-note">No third review agent; the worker never grades itself.</p>
				</section>
			</div>
		</div>
	);
}

function Inspector({
	current,
	queue,
	paused,
	planChoice,
	setPlanChoice,
	planState,
	onApprove,
	onPass,
	onTogglePause,
}: {
	current: string;
	queue: string[];
	paused: boolean;
	planChoice: "preserve" | "compact" | "fresh" | "save";
	setPlanChoice: (value: "preserve" | "compact" | "fresh" | "save") => void;
	planState: "pending" | "approved";
	onApprove: () => void;
	onPass: () => void;
	onTogglePause: () => void;
}) {
	return (
		<aside className="tp-inspector">
			<section className="tp-panel tp-digest">
				<header><span>Team pulse</span><span className="tp-live">live</span></header>
				<div className="tp-pulse-number">3<span>agents active</span></div>
				<div className="tp-pulse-bars">
					<div><span>Kai</span><i style={{ width: "72%" }} /></div>
					<div><span>Nova</span><i style={{ width: "58%" }} /></div>
					<div><span>Rin</span><i style={{ width: "35%" }} /></div>
				</div>
			</section>
			<section className="tp-panel">
				<header><span>Speaking queue</span><button type="button" className="tp-link" onClick={onTogglePause}>{paused ? "Resume" : "Pause"}</button></header>
				<div className="tp-speaker"><Avatar member={memberById(current)} size={32} /><div><b>{memberById(current).name}</b><small>{paused ? "paused" : "current speaker"}</small></div></div>
				<div className="tp-queue">
					{queue.map((id, index) => (
						<div key={id} className="tp-queue-row"><span>{index + 1}</span><b>{memberById(id).name}</b><small>waiting</small></div>
					))}
				</div>
				<button type="button" className="tp-secondary full" onClick={onPass}><Icon name="handoff" /> Pass turn</button>
			</section>
			<section className="tp-panel tp-plan">
				<header><span>Plan review</span><span className={`tp-state ${planState}`}>{planState}</span></header>
				<p className="tp-plan-title">Auth rollout · checkpoint handoff</p>
				<div className="tp-options">
					{([
						["preserve", "Preserve", "Same session, no compaction"],
						["compact", "Compact", "Compact, then execute"],
						["fresh", "Fresh", "Old leaves, new seat joins"],
						["save", "Save", "Store, do not execute"],
					] as const).map(([value, label, description]) => (
						<button type="button" key={value} className={planChoice === value ? "active" : ""} onClick={() => setPlanChoice(value)}>
							<span><b>{label}</b><small>{description}</small></span>
							{planChoice === value ? <Icon name="check" extra="sm" /> : null}
						</button>
					))}
				</div>
				<button type="button" className="tp-primary full" onClick={onApprove}><Icon name="check" /> Approve plan</button>
				<p className="tp-note">PM approves; the engineer consumes the plan. No auto-execute.</p>
			</section>
			<section className="tp-panel tp-digest">
				<header><span>Latest digest</span><span className="tp-muted">12s ago</span></header>
				<p>Kai is implementing the digest envelope; Nova is reviewing queue ordering.</p>
				<span className="tp-link">Roster in the left rail <Icon name="arrow-r" extra="sm" /></span>
			</section>
		</aside>
	);
}

function ChannelsPanel() {
	return (
		<section className="tp-channels" aria-label="Channel adapters">
			<header className="tp-channels-head">
				<div>
					<h2>Channels</h2>
					<p>Bridge an external team network into the studio. Adapters are configured here; the Team workspace stays local until one is connected.</p>
				</div>
				<span className="tp-channel-badge">Not configured</span>
			</header>
			<article className="tp-channel-row">
				<span className="tp-channel-mark">TIM</span>
				<div className="tp-channel-copy">
					<b>TIM adapter</b>
					<p>Team Instant Messaging networks reach Studio through a channel adapter.</p>
				</div>
				<span className="tp-channel-state">Unavailable</span>
			</article>
			<div className="tp-channel-next">
				<b>Configure in Channels</b>
				<p>This build reserves the TIM adapter surface. No adapter is bundled, so no workspace, channel, or message is synchronized yet.</p>
				<ul>
					<li><span>Endpoint</span><em>Not set</em></li>
					<li><span>Access token</span><em>Not set</em></li>
					<li><span>Workspace / channel</span><em>Not set</em></li>
				</ul>
				<small>Reserved surface: adapter configuration is not wired in this build.</small>
			</div>
		</section>
	);
}

export function TeamPage({ onOpenAgentHub }: { onOpenAgentHub?: () => void }) {
	const [initialIntent] = useState<TeamView | null>(() => takeTeamIntent());
	const [view, setView] = useState<TeamView>(initialIntent ?? "team");
	const [tab, setTab] = useState<TeamTab>(initialIntent === "channels" ? "channels" : "chat");

	useEffect(() => {
		const onIntent = (event: Event) => {
			const next = (event as CustomEvent<TeamView>).detail;
			setView(next);
			setTab((current) => (next === "channels" ? "channels" : current === "channels" ? "chat" : current));
		};
		window.addEventListener(TEAM_INTENT_EVENT, onIntent);
		return () => window.removeEventListener(TEAM_INTENT_EVENT, onIntent);
	}, []);

	const selectView = (next: TeamView) => {
		setView(next);
		setTab((current) => (next === "channels" ? "channels" : current === "channels" ? "chat" : current));
	};

	const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
	const [draft, setDraft] = useState("");
	const [address, setAddress] = useState<Address>("room");
	const [mention, setMention] = useState("kai");
	const [filter, setFilter] = useState("");
	const [cards, setCards] = useState<Card[]>(INITIAL_BOARD);
	const [selectedCard, setSelectedCard] = useState<string | null>(null);
	const [current, setCurrent] = useState("kai");
	const [queue, setQueue] = useState(["nova", "rin"]);
	const [paused, setPaused] = useState(false);
	const [planChoice, setPlanChoice] = useState<"preserve" | "compact" | "fresh" | "save">("preserve");
	const [planState, setPlanState] = useState<"pending" | "approved">("pending");
	const [settings, setSettings] = useState<Settings>(INITIAL_SETTINGS);

	const selected = selectedCard ? cards.find((card) => card.id === selectedCard) : undefined;

	const onReact = (id: string, emoji: string) => {
		setMessages((items) => items.map((message) => {
			if (message.id !== id) return message;
			const count = message.reactions[emoji] ?? 0;
			return { ...message, reactions: { ...message.reactions, [emoji]: count + 1 } };
		}));
	};

	const onSend = () => {
		const text = draft.trim();
		if (!text) return;
		const target = address === "room" ? MEMBERS.filter((member) => member.id !== ME.id).map((member) => member.id) : address === "all" ? MEMBERS.filter((member) => member.id !== ME.id).map((member) => member.id) : [mention];
		setMessages((items) => [...items, {
			id: `m-${items.length + 1}`,
			author: ME.id,
			text,
			time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
			to: target,
			delivery: "queued",
			reactions: {},
		}]);
		setDraft("");
	};

	const onPass = () => {
		const next = queue[0];
		if (!next) return;
		setCurrent(next);
		setQueue((items) => items.slice(1));
	};

	const setSetting = (key: keyof Settings, value: boolean) => setSettings((currentSettings) => ({ ...currentSettings, [key]: value }));

	const addCard = () => {
		const id = `t-${cards.length + 1}`;
		setCards((items) => [...items, { id, title: "New task", owner: "you", repo: "zeta/core", progress: 0, state: "Backlog", tags: ["new"], note: "Prototype task card." }]);
	};

	return (
		<div className="tp-page">
			<div className="tp-top">
				<div className="tp-team">
					<span className="tp-team-mark"><Icon name="network" /></span>
					<div><b>Zeta Core</b><small>{view === "channels" ? "Channel adapters" : "Team workspace"}</small></div>
					<span className="tp-proto">prototype</span>
				</div>
				<div className="tp-switch" role="group" aria-label="Workspace mode">
					<button type="button" aria-pressed={view === "team"} className={view === "team" ? "active" : ""} onClick={() => selectView("team")}>
						<Icon name="network" extra="sm" />Team
					</button>
					<button type="button" aria-pressed={view === "channels"} className={view === "channels" ? "active" : ""} onClick={() => selectView("channels")}>
						<Icon name="plug" extra="sm" />Channels
					</button>
				</div>
				<div className="tp-tabs" role="tablist" aria-label="Team views">
					{(["chat", "board", "calendar", "settings"] as const).map((id) => (
						<button
							type="button"
							key={id}
							role="tab"
							aria-selected={tab === id}
							className={tab === id ? "active" : ""}
							onClick={() => {
								setView("team");
								setTab(id);
							}}
						>
							{id === "chat" ? <Icon name="message" extra="sm" /> : id === "board" ? <Icon name="columns" extra="sm" /> : id === "calendar" ? <Icon name="clock" extra="sm" /> : <Icon name="settings" extra="sm" />}
							{id[0]!.toUpperCase() + id.slice(1)}
						</button>
					))}
				</div>
				<div className="tp-top-actions">
					<button type="button" className="tp-icon-button" onClick={() => setTab("calendar")} aria-label="Calendar"><Icon name="clock" /></button>
					<button type="button" className="tp-icon-button" onClick={onOpenAgentHub} aria-label="Agent Hub"><Icon name="bot" /></button>
				</div>
			</div>
			<div className={`tp-layout ${tab === "settings" || tab === "channels" ? "wide" : ""}${tab === "channels" ? " channels" : ""}`}>
				<aside className="tp-side">
					<div className="tp-side-section">
						<header><span>Rooms</span><button type="button" onClick={() => setTab("chat")} aria-label="Open rooms"><Icon name="plus" extra="sm" /></button></header>
						{["general", "auth", "release", "design"].map((room) => (
							<button type="button" key={room} className={`tp-room${room === "general" ? " active" : ""}`} onClick={() => { setTab("chat"); setFilter(""); }}>
								<span>#</span>{room}{room === "general" ? <b className="tp-unread">4</b> : null}
							</button>
						))}
					</div>
					<div className="tp-side-section">
						<header><span>Roster</span><span className="tp-muted">{MEMBERS.length}</span></header>
						{MEMBERS.map((member) => (
							<button type="button" key={member.id} className="tp-member" onClick={() => { setTab("chat"); setMention(member.id); setAddress("one"); }}>
								<Avatar member={member} size={30} />
								<span className="tp-member-text"><b>{member.name}</b><small>{member.role}</small></span>
								<StatusDot status={member.status} />
							</button>
						))}
					</div>
					<div className="tp-side-card">
						<span className="tp-side-card-icon"><Icon name="sparkles" /></span>
						<b>Team digest</b>
						<p>Latest recaps, current tickets, and blockers in one glance.</p>
						<button type="button" className="tp-link" onClick={() => setTab("board")}>Open details <Icon name="arrow-r" extra="sm" /></button>
					</div>
				</aside>
				<main className="tp-main">
					{tab === "chat" ? (
						<ChatView
							messages={messages}
							onReact={onReact}
							onSend={onSend}
							draft={draft}
							setDraft={setDraft}
							address={address}
							setAddress={setAddress}
							mention={mention}
							setMention={setMention}
							filter={filter}
							setFilter={setFilter}
						/>
					) : null}
					{tab === "board" ? <BoardView cards={cards} onOpen={setSelectedCard} onNew={addCard} /> : null}
					{tab === "calendar" ? <CalendarView events={CALENDAR} /> : null}
					{tab === "channels" ? <ChannelsPanel /> : null}
					{tab === "settings" ? <SettingsView settings={settings} setSetting={setSetting} /> : null}
				</main>
				{tab !== "settings" && tab !== "channels" ? (
					<Inspector
						current={current}
						queue={queue}
						paused={paused}
						planChoice={planChoice}
						setPlanChoice={setPlanChoice}
						planState={planState}
						onApprove={() => setPlanState("approved")}
						onPass={onPass}
						onTogglePause={() => setPaused((value) => !value)}
					/>
				) : null}
			</div>
			{selected ? (
				<div className="tp-drawer-backdrop" role="presentation" onClick={() => setSelectedCard(null)}>
					<aside className="tp-drawer" role="dialog" aria-modal="true" aria-label="Task detail" onClick={(event) => event.stopPropagation()}>
						<header>
							<span className={`tp-priority ${selected.tags[0]}`} />
							<div><small>{selected.state}</small><h3>{selected.title}</h3></div>
							<button type="button" className="tp-icon-button" onClick={() => setSelectedCard(null)} aria-label="Close"><Icon name="x" /></button>
						</header>
						<div className="tp-drawer-grid">
							<div><small>Owner</small><b>{memberById(selected.owner).name}</b></div>
							<div><small>Repo</small><b>{selected.repo}</b></div>
							<div><small>Progress</small><b>{selected.progress}%</b></div>
							<div><small>Tags</small><b>{selected.tags.join(" · ")}</b></div>
						</div>
						<p>{selected.note}</p>
						<div className="tp-progress large"><i style={{ width: `${selected.progress}%` }} /></div>
						<div className="tp-drawer-actions">
							<button type="button" className="tp-primary" onClick={() => { setCards((items) => items.map((card) => card.id === selected.id ? { ...card, state: "Review", progress: Math.max(card.progress, 80) } : card)); setSelectedCard(null); }}><Icon name="check" /> Mark ready</button>
							<button type="button" className="tp-secondary" onClick={() => { setCards((items) => items.map((card) => card.id === selected.id ? { ...card, owner: "nova" } : card)); setSelectedCard(null); }}><Icon name="handoff" /> Reassign</button>
						</div>
					</aside>
				</div>
			) : null}
			{tab === "board" || tab === "channels" ? null : <button type="button" className="tp-fab" onClick={addCard} aria-label="New task"><Icon name="plus" /></button>}
		</div>
	);
}
