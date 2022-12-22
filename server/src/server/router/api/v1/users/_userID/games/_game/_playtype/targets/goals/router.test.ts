/* eslint-disable no-await-in-loop */
import dm from "deepmerge";
import db from "external/mongo/db";
import { IIDX_GRADES, IIDX_LAMPS } from "tachi-common";
import t from "tap";
import { CreateFakeAuthCookie } from "test-utils/fake-auth";
import mockApi from "test-utils/mock-api";
import ResetDBState from "test-utils/resets";
import { TestSnapshot } from "test-utils/single-process-snapshot";
import {
	HC511Goal,
	HC511UserGoal,
	IIDXSPQuestGoals,
	IIDXSPQuestGoalSubs,
	Testing511SPA,
	TestingIIDXFolderSP10,
	TestingIIDXSPQuest,
	TestingIIDXSPQuestSub,
	TestingIIDXSPScore,
	TestingIIDXSPScorePB,
} from "test-utils/test-data";
import { CreateFolderChartLookup } from "utils/folder";
import type { ChartDocument, GoalSubscriptionDocument, PBScoreDocument } from "tachi-common";

// @ts-expect-error Not sure why the types break here, but they do.
const dupedGoal = dm({}, HC511Goal);

// @ts-expect-error Not sure why the types break here, but they do.
const dupedGoalSub = dm({}, HC511UserGoal);

// having two charts available is useful here for testing multi-chart goals.
const anotherFakeChart = dm(Testing511SPA, {
	chartID: "another_chart",
	difficulty: "HYPER",
	data: {},
}) as ChartDocument;

t.test("GET /api/v1/users/:userID/games/:game/:playtype/targets/goals", (t) => {
	t.beforeEach(ResetDBState);

	t.test("Should retrieve this user's goal subscriptions.", async (t) => {
		await db.goals.insert(dupedGoal);
		await db["goal-subs"].insert(dupedGoalSub);

		const res = await mockApi.get("/api/v1/users/1/games/iidx/SP/targets/goals");

		t.equal(res.statusCode, 200);

		// due to poor design decisions, these props may be set anyway.
		delete HC511Goal._id;
		delete HC511UserGoal._id;

		t.strictSame(res.body.body, {
			goals: [HC511Goal],
			goalSubs: [HC511UserGoal],
			quests: [],
			questSubs: [],
		});

		t.end();
	});

	t.end();
});

t.test("POST /api/v1/users/:userID/games/:game/:playtype/targets/add-goal", async (t) => {
	t.beforeEach(ResetDBState);

	const customScorePB = dm(TestingIIDXSPScorePB, {
		scoreData: TestingIIDXSPScore.scoreData,
	}) as PBScoreDocument;

	t.beforeEach(async () => {
		await db["personal-bests"].remove({});
		await db["personal-bests"].insert(customScorePB);
	});

	const cookie = await CreateFakeAuthCookie(mockApi);

	const baseInput = {
		criteria: {
			key: "scoreData.percent",
			value: 80,
			mode: "single",
		},
		charts: {
			type: "single",
			data: Testing511SPA.chartID,
		},
	};

	function mkInput(caseName: string, merge: any) {
		const input = {
			caseName,
			content: dm(baseInput, merge) as any,
		};

		// if we've set this prop to undefined, we want to delete it, actually.
		if (input.content.charts.data === undefined) {
			delete input.content.charts.data;
		}

		return input;
	}

	t.beforeEach(() => db.charts.iidx.insert(anotherFakeChart));

	// @ts-expect-error weird type issues
	t.beforeEach(() => db.folders.insert(dm(TestingIIDXFolderSP10, {})));

	t.beforeEach(() => CreateFolderChartLookup(TestingIIDXFolderSP10, true));

	const multiCharts = {
		type: "multi",
		data: [Testing511SPA.chartID, "another_chart"],
	};

	const folderCharts = {
		type: "folder",
		data: TestingIIDXFolderSP10.folderID,
	};

	const absModeCriteria = {
		mode: "absolute",
		countNum: 2,
	};

	const proportionModeCriteria = {
		mode: "proportion",
		countNum: 1,
	};

	t.test("Should set valid goals.", async (t) => {
		const validInput = [
			mkInput("Percent:Single Case", {}),
			mkInput("Score:Single Case", {
				criteria: {
					key: "scoreData.score",
					value: 1000,
				},
			}),
			mkInput("LampIndex:Single Case", {
				criteria: {
					key: "scoreData.lampIndex",
					value: IIDX_LAMPS.EX_HARD_CLEAR,
				},
			}),
			mkInput("GradeIndex:Single Case", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: IIDX_GRADES.AAA,
				},
			}),
			mkInput("Percent:Multi Case", {
				charts: multiCharts,
			}),
			mkInput("Percent:Multi:Abs Case", {
				criteria: absModeCriteria,
				charts: multiCharts,
			}),

			// NOT LEGAL FOR IIDX, due to being nonsense! NEEDS SPECIFIC TESTING.
			// mkInput("Score:Multi Case", {
			// 	criteria: {
			// 		key: "scoreData.score",
			// 		value: 1,
			// 	},
			// 	charts: multiCharts,
			// }),
			mkInput("LampIndex:Multi Case", {
				criteria: {
					key: "scoreData.lampIndex",
					value: IIDX_LAMPS.HARD_CLEAR,
				},
				charts: multiCharts,
			}),
			mkInput("LampIndex:Multi:Abs Case", {
				criteria: {
					key: "scoreData.lampIndex",
					value: IIDX_LAMPS.HARD_CLEAR,
					...absModeCriteria,
				},
				charts: multiCharts,
			}),

			mkInput("GradeIndex:Multi Case", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: IIDX_GRADES.AAA,
				},
				charts: multiCharts,
			}),
			mkInput("GradeIndex:Multi:Abs Case", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: IIDX_GRADES.AAA,
					...absModeCriteria,
				},
				charts: multiCharts,
			}),
			mkInput("Percent:Folder Case", {
				charts: folderCharts,
			}),
			mkInput("Percent:Folder:Abs Case", {
				criteria: absModeCriteria,
				charts: folderCharts,
			}),
			mkInput("Percent:Folder:Proportion Case", {
				criteria: proportionModeCriteria,
				charts: folderCharts,
			}),

			// also illegal in iidx, bms and pms.
			// mkInput("Score:Folder Case", {
			// 	criteria: {
			// 		key: "scoreData.score",
			// 		value: 1000,
			// 	},
			// 	charts: folderCharts,
			// }),
			mkInput("LampIndex:Folder Case", {
				criteria: {
					key: "scoreData.lampIndex",
					value: IIDX_LAMPS.HARD_CLEAR,
				},
				charts: folderCharts,
			}),
			mkInput("LampIndex:Folder:Abs Case", {
				criteria: {
					key: "scoreData.lampIndex",
					value: IIDX_LAMPS.HARD_CLEAR,
					...absModeCriteria,
				},
				charts: folderCharts,
			}),
			mkInput("LampIndex:Folder:Proportion Case", {
				criteria: {
					key: "scoreData.lampIndex",
					value: IIDX_LAMPS.HARD_CLEAR,
					...proportionModeCriteria,
				},
				charts: folderCharts,
			}),
			mkInput("GradeIndex:Folder Case", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: IIDX_GRADES.AAA,
				},
				charts: folderCharts,
			}),
			mkInput("GradeIndex:Folder:Abs Case", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: IIDX_GRADES.AAA,
					...absModeCriteria,
				},
				charts: folderCharts,
			}),
			mkInput("GradeIndex:Folder:Proportion Case", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: IIDX_GRADES.AAA,
					...proportionModeCriteria,
				},
				charts: folderCharts,
			}),
		];

		for (const input of validInput) {
			await t.test(`Valid Goal: ${input.caseName}`, async (t) => {
				const res = await mockApi
					.post("/api/v1/users/1/games/iidx/SP/targets/goals/add-goal")
					.set("Cookie", cookie)
					.send(input.content);

				t.equal(
					// eslint-disable-next-line lines-around-comment
					// this looks stupid, but results in better errmsgs.
					res.statusCode === 200 ? 200 : res.body.description,
					200,
					"Should return 200"
				);

				// don't bother doing db checks if this is good.
				if (res.statusCode !== 200) {
					return;
				}

				const existsInDb = await db.goals.findOne({
					charts: input.content.charts,
					criteria: input.content.criteria,
				});

				t.not(existsInDb, null, "A new goal should be added to the database.");

				const subscribed = await db["goal-subs"].findOne({
					userID: 1,
					goalID: existsInDb?.goalID ?? "edge_case",
				});

				t.not(
					subscribed,
					null,
					`Requesting user 1 should be subscribed to their new goal.`
				);

				t.end();
			});
		}

		t.end();
	});

	t.test("Should reject invalid goals.", async (t) => {
		const invalidInput = [
			mkInput("negative percent", {
				criteria: {
					value: -1,
				},
			}),
			mkInput("percent of 0 is a non-goal", {
				criteria: {
					value: 0,
				},
			}),
			mkInput("percent greater than 100", {
				criteria: {
					value: 100.1,
				},
			}),
			mkInput("too big grade", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: IIDX_GRADES.MAX + 1,
				},
			}),
			mkInput("invalid grade", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: 0.5,
				},
			}),
			mkInput("too big lamp", {
				criteria: {
					key: "scoreData.lampIndex",
					value: IIDX_LAMPS.FULL_COMBO + 1,
				},
			}),
			mkInput("invalid lamp", {
				criteria: {
					key: "scoreData.lampIndex",
					value: 0.5,
				},
			}),
			mkInput("too big score", {
				criteria: {
					key: "scoreData.score",
					value: 9_000,
				},
			}),
			mkInput("abs without countNum", {
				criteria: {
					mode: "absolute",
				},
				charts: multiCharts,
			}),
			mkInput("proportion without countNum", {
				criteria: {
					mode: "proportion",
				},
				charts: multiCharts,
			}),
			mkInput("single with countNum", {
				criteria: {
					mode: "single",
					countNum: 123,
				},
			}),
			mkInput("proportion with negative countNum", {
				criteria: {
					mode: "proportion",
					countNum: -0.5,
				},
				charts: multiCharts,
			}),
			mkInput("proportion with greater than 1 countNum", {
				criteria: {
					mode: "proportion",
					countNum: 1.1,
				},
				charts: multiCharts,
			}),
			mkInput("proportion which results in countNum of 0", {
				criteria: {
					mode: "proportion",
					countNum: 0.05,
				},
				charts: multiCharts,
			}),
			mkInput("nonsense mode", {
				criteria: {
					mode: "nonsense",
				},
			}),
			mkInput("abs with countNum but charts.type == single", {
				criteria: {
					mode: "absolute",
					countNum: 1,
				},
				charts: {
					type: "single",
				},
			}),
			mkInput("nonsense charts.type", {
				charts: {
					type: "nonsense",
				},
			}),
			mkInput("charts.data array when type == single", {
				charts: {
					type: "single",
					data: multiCharts.data,
				},
			}),
			mkInput("charts.data array of identical chartIDs", {
				charts: {
					type: "multi",
					data: [Testing511SPA.chartID, Testing511SPA.chartID],
				},
			}),
			mkInput("charts.data array of single chartID", {
				charts: {
					type: "multi",
					data: [Testing511SPA.chartID],
				},
			}),
			mkInput("charts.data array of chartIDs where some don't exist", {
				charts: {
					type: "multi",
					data: [Testing511SPA.chartID, "not_exist"],
				},
			}),
			mkInput("charts.data folder refers to folder that doesn't exist", {
				charts: {
					type: "folder",
					data: "fake-folder",
				},
			}),
			mkInput("nonsense charts.data", {
				charts: {
					data: "nonsense",
				},
			}),
			mkInput("multi-score for iidx is illegal", {
				criteria: {
					key: "scoreData.score",
					value: 1000,
				},
				charts: multiCharts,
			}),
			mkInput("folder-score for iidx is illegal", {
				criteria: {
					key: "scoreData.score",
					value: 1000,
				},
				charts: folderCharts,
			}),
			mkInput("charts single but criteria not.", {
				criteria: {
					mode: "absolute",
					countNum: 2,
				},
			}),
			mkInput("LampIndex:Multi:Proportion Case", {
				criteria: {
					key: "scoreData.lampIndex",
					value: IIDX_LAMPS.HARD_CLEAR,
					...proportionModeCriteria,
				},
				charts: multiCharts,
			}),
			mkInput("GradeIndex:Multi:Proportion Case", {
				criteria: {
					key: "scoreData.gradeIndex",
					value: IIDX_GRADES.AAA,
					...proportionModeCriteria,
				},
				charts: multiCharts,
			}),
			mkInput("Percent:Multi:Proportion Case", {
				criteria: proportionModeCriteria,
				charts: multiCharts,
			}),
		];

		for (const input of invalidInput) {
			await t.test(`Invalid Goal: ${input.caseName}`, async (t) => {
				const res = await mockApi
					.post("/api/v1/users/1/games/iidx/SP/targets/goals/add-goal")
					.set("Cookie", cookie)
					.send(input.content);

				t.equal(res.statusCode, 400);

				TestSnapshot(t, res.body.description, `Invalid Goal: ${input.caseName}`);

				t.end();
			});
		}

		t.end();
	});

	t.test("Should reject if user tries to subscribe to already subscribed goal.", async (t) => {
		const res = await mockApi
			.post("/api/v1/users/1/games/iidx/SP/targets/goals/add-goal")
			.set("Cookie", cookie)
			.send(baseInput);

		t.equal(res.statusCode, 200, "Should allow a subscription the first time.");

		const res2 = await mockApi
			.post("/api/v1/users/1/games/iidx/SP/targets/goals/add-goal")
			.set("Cookie", cookie)
			.send(baseInput);

		t.equal(res2.statusCode, 409, "Should fail the second time.");

		t.end();
	});

	t.test("Should reject if user tries to subscribe to immediately achieved goal.", async (t) => {
		const res = await mockApi
			.post("/api/v1/users/1/games/iidx/SP/targets/goals/add-goal")
			.set("Cookie", cookie)
			.send(
				dm(baseInput, {
					criteria: {
						key: "scoreData.score",
						value: 1,
					},
				})
			);

		t.equal(
			res.statusCode,
			400,
			"Should disallow goal subscriptions that would be instantly achieved."
		);

		t.end();
	});

	t.end();
});

t.test("GET /api/v1/users/:userID/games/:game/:playtype/targets/goals/:goalID", (t) => {
	t.beforeEach(ResetDBState);

	t.test("Should retrieve this user's goal subscription.", async (t) => {
		await db.goals.insert(dupedGoal);
		await db["goal-subs"].insert(dupedGoalSub);

		const res = await mockApi.get(
			`/api/v1/users/1/games/iidx/SP/targets/goals/${HC511Goal.goalID}`
		);

		t.equal(res.statusCode, 200);

		t.hasStrict(res.body.body, {
			goal: HC511Goal,
			goalSub: HC511UserGoal,
			quests: [],
			user: {
				id: 1,
			},
		});

		t.end();
	});

	t.test("Should return parent quests if goal has any.", async (t) => {
		await db.goals.insert(IIDXSPQuestGoals);
		await db["goal-subs"].insert(IIDXSPQuestGoalSubs);
		await db.quests.insert(TestingIIDXSPQuest);

		if (!IIDXSPQuestGoalSubs[0] || !IIDXSPQuestGoals[0]) {
			throw new Error(`Expected atleast one quest goal or sub to work with?`);
		}

		const res = await mockApi.get(
			`/api/v1/users/1/games/iidx/SP/targets/goals/${IIDXSPQuestGoalSubs[0].goalID}`
		);

		t.equal(res.statusCode, 200);

		delete IIDXSPQuestGoals[0]._id;
		delete IIDXSPQuestGoalSubs[0]._id;
		delete TestingIIDXSPQuest._id;

		t.hasStrict(res.body.body, {
			goal: IIDXSPQuestGoals[0],
			goalSub: IIDXSPQuestGoalSubs[0],
			quests: [TestingIIDXSPQuest],
			user: {
				id: 1,
			},
		});

		t.end();
	});

	t.test("Should return 404 if the user is not subscribed to this goal ID.", async (t) => {
		const res = await mockApi.get(`/api/v1/users/1/games/iidx/SP/targets/goals/INVALID_GOAL`);

		t.equal(res.statusCode, 404);

		t.end();
	});

	t.end();
});

t.test("DELETE /api/v1/users/:userID/games/:game/:playtype/targets/goals/:goalID", async (t) => {
	t.beforeEach(ResetDBState);

	const cookie = await CreateFakeAuthCookie(mockApi);

	t.test("Should delete a goal subscription if subscribed.", async (t) => {
		await db.goals.insert(dupedGoal);
		await db["goal-subs"].insert(dupedGoalSub);

		const res = await mockApi
			.delete(`/api/v1/users/1/games/iidx/SP/targets/goals/${dupedGoalSub.goalID}`)
			.set("Cookie", cookie);

		t.equal(res.statusCode, 200);

		const dbRes = await db["goal-subs"].findOne({
			userID: 1,
			goalID: dupedGoal.goalID,
		});

		t.equal(dbRes, null, "Should delete the goal sub from the database.");

		t.end();
	});

	t.test("Should reject a goal deletion if goal has parent quests.", async (t) => {
		await db.quests.insert(TestingIIDXSPQuest);
		await db["quest-subs"].insert(TestingIIDXSPQuestSub);
		await db.goals.insert(IIDXSPQuestGoals);
		await db["goal-subs"].insert(
			dm(dupedGoalSub, { goalID: "eg_goal_1" }) as GoalSubscriptionDocument
		);

		const res = await mockApi
			.delete(`/api/v1/users/1/games/iidx/SP/targets/goals/eg_goal_1`)
			.set("Cookie", cookie);

		t.equal(res.statusCode, 400);
		t.equal(
			res.body.description,
			`This goal is part of a quest you are subscribed to. It can only be removed by unsubscribing from the relevant quests: '${TestingIIDXSPQuest.name}'.`
		);

		const dbRes = await db["goal-subs"].findOne({
			userID: 1,
			goalID: "eg_goal_1",
		});

		t.not(dbRes, null, "Should NOT delete the goal sub from the database.");

		t.end();
	});

	t.test("Should reject a goal deletion if not subscribed.", async (t) => {
		await db.goals.insert(dupedGoal);
		await db["goal-subs"].insert(dupedGoalSub);

		const res = await mockApi
			.delete(`/api/v1/users/1/games/iidx/SP/targets/goals/INVALID_GOAL`)
			.set("Cookie", cookie);

		t.equal(res.statusCode, 404);

		t.end();
	});

	t.test("Should reject a goal deletion if not authed.", async (t) => {
		await db.goals.insert(dupedGoal);
		await db["goal-subs"].insert(dupedGoalSub);

		const res = await mockApi.delete(
			`/api/v1/users/1/games/iidx/SP/targets/goals/${dupedGoalSub.goalID}`
		);

		t.equal(res.statusCode, 401);

		t.end();
	});

	t.end();
});
