import { GetGameConfig } from "tachi-common";
import t from "tap";
import mockApi from "test-utils/mock-api";

t.test("GET /api/v1/games/:game", (t) => {
	t.test("Should parse the game from the header", async (t) => {
		const res = await mockApi.get("/api/v1/games/iidx");

		t.hasStrict(GetGameConfig("iidx"), res.body.body);

		t.end();
	});

	t.test("Should reject an unsupported game.", async (t) => {
		const res = await mockApi.get("/api/v1/games/invalid_game");

		t.equal(res.statusCode, 400);

		t.end();
	});

	t.end();
});
