import { describe, expect, it } from "bun:test";
import { routeTeamChat, type TeamChatParticipant } from "../../src/team/chat-routing";

const main: TeamChatParticipant = { id: "main", name: "Main", kind: "main" };
const developer: TeamChatParticipant = { id: "dev", name: "Kit", aliases: ["fullstack"], kind: "worker" };
const reviewer: TeamChatParticipant = { id: "review", name: "Reva", aliases: ["reviewer"], kind: "worker" };
const members = [main, developer, reviewer];

describe("routeTeamChat", () => {
	it("routes a dm to exactly its target", () => {
		expect(routeTeamChat({ surface: "dm", senderId: "user", targetId: "dev", text: "hi" }, members)).toEqual({
			deliveries: [{ participantId: "dev", mode: "direct" }],
			unknownMentions: [],
		});
	});

	it("broadcasts an unmentioned group message as ambient context to every other participant", () => {
		const result = routeTeamChat({ surface: "group", senderId: "user", text: "status?" }, members);
		expect(result.deliveries).toEqual([
			{ participantId: "main", mode: "ambient" },
			{ participantId: "dev", mode: "ambient" },
			{ participantId: "review", mode: "ambient" },
		]);
	});

	it("directs only an explicitly mentioned worker and gives everyone else an assignment notice", () => {
		const result = routeTeamChat(
			{ surface: "group", senderId: "user", text: "@fullstack fix it", mentions: ["fullstack"] },
			members,
		);
		expect(result.deliveries).toEqual([
			{ participantId: "main", mode: "assigned-elsewhere" },
			{ participantId: "dev", mode: "direct" },
			{ participantId: "review", mode: "assigned-elsewhere" },
		]);
		expect(result.unknownMentions).toEqual([]);
	});

	it("leaves a main mention as a main decision and does not expand it to workers", () => {
		const result = routeTeamChat(
			{ surface: "group", senderId: "user", text: "@main decide", mentions: ["main"] },
			members,
		);
		expect(result.deliveries).toEqual([
			{ participantId: "main", mode: "direct" },
			{ participantId: "dev", mode: "assigned-elsewhere" },
			{ participantId: "review", mode: "assigned-elsewhere" },
		]);
	});

	it("supports multiple direct recipients and reports unknown mentions", () => {
		const result = routeTeamChat(
			{
				surface: "group",
				senderId: "user",
				text: "@Kit @reviewer @nobody",
				mentions: ["Kit", "reviewer", "nobody"],
			},
			members,
		);
		expect(result.deliveries).toEqual([
			{ participantId: "main", mode: "assigned-elsewhere" },
			{ participantId: "dev", mode: "direct" },
			{ participantId: "review", mode: "direct" },
		]);
		expect(result.unknownMentions).toEqual(["nobody"]);
	});

	it("does not send an agent its own message and treats a self mention as unknown", () => {
		const result = routeTeamChat(
			{ surface: "group", senderId: "dev", text: "@dev and @main", mentions: ["dev", "main"] },
			members,
		);
		expect(result.deliveries).toEqual([
			{ participantId: "main", mode: "direct" },
			{ participantId: "review", mode: "assigned-elsewhere" },
		]);
		expect(result.unknownMentions).toEqual(["dev"]);
	});
});
