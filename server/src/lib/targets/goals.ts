import { CreateGoalTitle as CreateGoalName, ValidateGoalChartsAndCriteria } from "./goal-utils";
import db from "external/mongo/db";
import fjsh from "fast-json-stable-hash";
import { GPT_SERVER_IMPLEMENTATIONS } from "game-implementations/game-implementations";
import { SubscribeFailReasons } from "lib/constants/err-codes";
import CreateLogCtx from "lib/logger/logger";
import { FormatGame, GetGPTConfig, GetGPTString, GetScoreMetricConf } from "tachi-common";
import { GetFolderChartIDs } from "utils/folder";
import type { GoalCriteriaFormatter } from "game-implementations/types";
import type { KtLogger } from "lib/logger/logger";
import type { FilterQuery } from "mongodb";
import type {
	Game,
	GoalDocument,
	GoalSubscriptionDocument,
	integer,
	PBScoreDocument,
	Playtype,
	QuestDocument,
	QuestSubscriptionDocument,
	GPTString,
	ScoreData,
} from "tachi-common";

const logger = CreateLogCtx(__filename);

export interface EvaluatedGoalReturn {
	achieved: boolean;
	progress: number | null;
	outOf: number;
	progressHuman: string;
	outOfHuman: string;
}

/**
 * Creates a goalID from a goals charts and criteria.
 *
 * This uses FJSH to stable-stringify the charts and criteria,
 * then hashes that string under sha256.
 *
 * @note We could do better here, by converting criteria
 * to 'similar' criteria - like 100% resolving to 1million score
 * but that proves very complex to implement when it comes
 * to multiple games.
 */
export function CreateGoalID(
	charts: GoalDocument["charts"],
	criteria: GoalDocument["criteria"],
	game: Game,
	playtype: Playtype
) {
	return `G${fjsh.hash({ charts, criteria, game, playtype }, "sha256")}`;
}

export async function EvaluateGoalForUser(
	goal: GoalDocument,
	userID: integer,
	logger: KtLogger
): Promise<EvaluatedGoalReturn | null> {
	// First, we need to resolve the set of charts this
	// goal involves.
	const chartIDs = await ResolveGoalCharts(goal);
	const gptString = GetGPTString(goal.game, goal.playtype);
	const gptConfig = GetGPTConfig(gptString);
	const scoreConf = GetScoreMetricConf(gptConfig, goal.criteria.key);

	if (!scoreConf) {
		throw new Error(
			`Invalid goal.criteria.key, got '${goal.criteria.key}', but no config exists for this metric for ${gptString}.`
		);
	}

	let scoreDataKey;

	if (scoreConf.type === "ENUM") {
		scoreDataKey = `scoreData.enumIndexes.${goal.criteria.key}`;
	} else {
		scoreDataKey = `scoreData.${goal.criteria.key}`;
	}

	// lets configure a "base" query for our requests.
	const scoreQuery: FilterQuery<PBScoreDocument> = {
		userID,
		game: goal.game,
		playtype: goal.playtype,

		// normally, this would be a VERY WORRYING line of code, but goal.criteria.key is guaranteed to be
		// within a specific set of fields.
		[scoreDataKey]: { $gte: goal.criteria.value },
		chartID: { $in: chartIDs },
	};

	switch (goal.criteria.mode) {
		case "single": {
			const res = await db["personal-bests"].findOne(scoreQuery);

			const outOfHuman = HumaniseGoalOutOf(gptString, goal.criteria.key, goal.criteria.value);

			if (res) {
				return {
					achieved: true,
					outOf: goal.criteria.value,
					progress:
						scoreConf.type === "ENUM"
							? // @ts-expect-error this is always correct but the typesystem is rightfully concerned
							  res.scoreData.enumIndexes[goal.criteria.key]
							: // @ts-expect-error see above
							  res.scoreData[goal.criteria.key],
					outOfHuman,
					progressHuman: HumaniseGoalProgress(
						gptString,
						goal.criteria.key,
						goal.criteria.value,
						res
					),
				};
			}

			// if we didn't find a PB that achieved the goal immediately
			// fetch the next best thing.
			const nextBestQuery: FilterQuery<PBScoreDocument> = {
				userID,
				game: goal.game,
				playtype: goal.playtype,
				chartID: { $in: chartIDs },
			};

			const nextBestScore = await db["personal-bests"].findOne(nextBestQuery, {
				sort: { [scoreDataKey]: -1 },
			});

			// user has no scores on any charts in this set.
			if (!nextBestScore) {
				return {
					achieved: false,
					outOf: goal.criteria.value,
					progress: null,
					outOfHuman,
					progressHuman: "NO DATA",
				};
			}

			return {
				achieved: false,
				outOf: goal.criteria.value,
				outOfHuman,
				progress:
					scoreConf.type === "ENUM"
						? // @ts-expect-error this is always correct but the typesystem is rightfully concerned
						  nextBestScore.scoreData.enumIndexes[goal.criteria.key]
						: // @ts-expect-error see above
						  nextBestScore.scoreData[goal.criteria.key],
				progressHuman: HumaniseGoalProgress(
					gptString,
					goal.criteria.key,
					goal.criteria.value,
					nextBestScore
				),
			};
		}

		case "absolute":
		case "proportion": {
			let count;

			// abs -> Absolute mode, such as clear 10 charts.
			if (goal.criteria.mode === "absolute") {
				count = goal.criteria.countNum;
			} else {
				// proportion -> Proportional mode, the value
				// is a multiplier for the amount of charts
				// available -- i.e. 0.1 * charts.
				const totalChartCount = chartIDs.length;

				count = Math.floor(goal.criteria.countNum * totalChartCount);
			}

			const userCount = await db["personal-bests"].count(scoreQuery);

			return {
				achieved: userCount >= count,
				progress: userCount,
				outOf: count,
				progressHuman: userCount.toString(),
				outOfHuman: count.toString(),
			};
		}

		default: {
			// note that this seemingly nonsensical type assertion is because typescript has whittled down
			// goal.criteria (correctly) to 'never', but we want to log if something somehow ends up here (it shouldn't).
			logger.warn(
				`Invalid goal: ${goal.goalID}, unknown criteria.mode ${
					(goal.criteria as GoalDocument["criteria"]).mode
				}, ignoring.`,
				{ goal }
			);

			return null;
		}
	}
}

/**
 * Resolves the set of charts involved with this goal.
 *
 * @returns An array of chartIDs.
 */
function ResolveGoalCharts(goal: GoalDocument): Array<string> | Promise<Array<string>> {
	switch (goal.charts.type) {
		case "single":
			return [goal.charts.data];
		case "multi":
			return goal.charts.data;
		case "folder":
			return GetFolderChartIDs(goal.charts.data);
		default:
			// @ts-expect-error This can't happen normally, but if it does, I want to
			// handle it properly.
			throw new Error(`Unknown goal.charts.type of ${goal.charts.type}`);
	}
}

type GoalKeys = GoalDocument["criteria"]["key"];

/**
 * Turn a users progress (i.e. their PB on a chart where the goal is "AAA $chart")
 * into a human-understandable string.
 *
 * This applies GPT-specific formatting in some cases, like appending 'bp' to
 * IIDX lamp goals.
 */
export function HumaniseGoalProgress(
	gptString: GPTString,
	key: GoalKeys,
	goalValue: integer,
	userPB: PBScoreDocument
): string {
	const gptImpl = GPT_SERVER_IMPLEMENTATIONS[gptString];

	// @ts-expect-error yeah this might fail, i know.
	const formatter = gptImpl.goalProgressFormatters[key];

	if (!formatter) {
		throw new Error(
			`Attempted to format progress for metric '${key}' when no such score metric exists for ${gptString}.`
		);
	}

	return formatter(userPB, goalValue);
}

/**
 * Turn a goal's "outOf" (i.e. HARD CLEAR; AAA or score=2450) into a human-understandable
 * string.
 */
export function HumaniseGoalOutOf(gptString: GPTString, key: GoalKeys, value: number) {
	const gptConf = GetGPTConfig(gptString);

	const metricConf = GetScoreMetricConf(gptConf, key);

	if (!metricConf) {
		throw new Error(
			`Attempted to format outOf for metric '${key}' when no such score metric exists for ${gptString}.`
		);
	}

	if (metricConf.type === "ENUM") {
		const val = metricConf.values[value];

		if (val === undefined) {
			throw new Error(
				`Attempted to format outOf for metric '${key}' but no such enum exists at index ${value}. (${gptString})`
			);
		}

		return val;
	}

	const gptImpl = GPT_SERVER_IMPLEMENTATIONS[gptString];

	// @ts-expect-error yeah this is technically unsafe, whatever
	const fmt: GoalCriteriaFormatter | undefined = gptImpl.goalOutOfFormatters[key];

	if (!fmt) {
		throw new Error(
			`Invalid metric '${key}' passed to format outOf, as no goalCriteriaFormatter exists for it.`
		);
	}

	return fmt(value);
}

/**
 * Given some data about a goal, create a full Goal Document from it. This returns
 * the goal document on success, and throws/panics on error.
 *
 * @param criteria - The criteria for this goal.
 * @param charts - The set of charts relevant to this goal.
 */
export async function ConstructGoal(
	charts: GoalDocument["charts"],
	criteria: GoalDocument["criteria"],
	game: Game,
	playtype: Playtype
): Promise<GoalDocument> {
	// Throws if the charts or criteria are invalid somehow.
	await ValidateGoalChartsAndCriteria(charts, criteria, game, playtype);

	// @ts-expect-error It's complaining because the potential criteria types might mismatch.
	// they're right, but this is enforced by ValidateGoalChartsAndCriteria.
	const goalDocument: GoalDocument = {
		game,
		playtype,
		criteria,
		charts,
		goalID: CreateGoalID(charts, criteria, game, playtype),
		name: await CreateGoalName(charts, criteria, game, playtype),
	};

	return goalDocument;
}

/**
 * Subscribes a user to the provided goal document. Handles deduping goals naturally
 * and general good stuff.
 *
 * @param isStandaloneAssigment - is this a "standalone assignment?", as in, not a
 * consequence of a quest assignment. Standalone assignments are not allowed to be
 * instantly-achieved. if they are, it will fail with
 * SubscribeFailReasons.ALREADY_ACHIEVED.
 *
 * Returns null if the user is already subscribed to this goal.
 */
export async function SubscribeToGoal(
	userID: integer,
	goalDocument: GoalDocument,
	isStandaloneAssignment: boolean
) {
	const goalExists = await db.goals.findOne({ goalID: goalDocument.goalID });

	if (!goalExists) {
		await db.goals.insert(goalDocument);
		logger.info(`Inserting new goal '${goalDocument.name}'.`);
	}

	const userAlreadySubscribed = await db["goal-subs"].findOne({
		userID,
		goalID: goalDocument.goalID,
	});

	if (userAlreadySubscribed) {
		// A quest trying to assign an already subscribed goal should know that.
		// (not that it cares)
		if (!isStandaloneAssignment) {
			return SubscribeFailReasons.ALREADY_SUBSCRIBED;
		}

		// if the user was already standalone-subscribed, ignore another standalone
		// assignment.
		if (userAlreadySubscribed.wasAssignedStandalone) {
			return SubscribeFailReasons.ALREADY_SUBSCRIBED;
		}

		// otherwise, this is a standalone assignment to a goal that was already assigned
		// as a consequence of a quest. Mark it as standalone
		await db["goal-subs"].update(
			{
				userID,
				goalID: goalDocument.goalID,
			},
			{
				$set: {
					wasAssignedStandalone: true,
				},
			}
		);

		// return this goal sub document, it's fast!
		return { ...userAlreadySubscribed, wasAssignedStandalone: true };
	}

	const result = await EvaluateGoalForUser(goalDocument, userID, logger);

	if (!result) {
		throw new Error(`Couldn't evaluate goal? See previous logs.`);
	}

	// standalone assignments shouldn't be allowed to assign instantly-achieved
	// goals
	if (result.achieved && isStandaloneAssignment) {
		return SubscribeFailReasons.ALREADY_ACHIEVED;
	}

	// @ts-expect-error TS can't resolve this.
	// because it can't explode out the types.
	const goalSub: GoalSubscriptionDocument = {
		outOf: result.outOf,
		outOfHuman: result.outOfHuman,
		progress: result.progress,
		progressHuman: result.progressHuman,
		userID,
		lastInteraction: null,
		timeAchieved: result.achieved ? Date.now() : null,
		game: goalDocument.game,
		playtype: goalDocument.playtype,
		goalID: goalDocument.goalID,
		achieved: result.achieved,
		wasInstantlyAchieved: result.achieved,
		wasAssignedStandalone: isStandaloneAssignment,
	};

	await db["goal-subs"].insert(goalSub);

	return goalSub;
}

export function GetQuestsThatContainGoal(goalID: string) {
	return db.quests.find({
		"questData.goals.goalID": goalID,
	});
}

/**
 * Unsubscribing from a goal may not be legal, because the goal might be part of
 * a quest the user is subscribed to. This function returns all quests
 * and questSubs that a goal is attached to.
 *
 * If this query matches none, an empty array is returned.
 */
export async function GetQuestSubsWhichDependOnThisGoalSub(
	goalSub: GoalSubscriptionDocument
): Promise<Array<QuestSubscriptionDocument & { quest: QuestDocument }>> {
	const dependencies: Array<QuestSubscriptionDocument & { quest: QuestDocument }> = await db[
		"quest-subs"
	].aggregate([
		{
			// find all quests that this user is subscribed to
			$match: {
				userID: goalSub.userID,
				game: goalSub.game,
				playtype: goalSub.playtype,
			},
		},
		{
			// look up the parent quests
			$lookup: {
				from: "quests",
				localField: "questID",
				foreignField: "questID",
				as: "parentQuestSubs",
			},
		},
		{
			// then project it onto the $quest field. This will be null
			// if the quest has no parent, which we hopefully won't have
			// to consider (illegal)
			$set: {
				quest: { $arrayElemAt: ["$parentQuestSubs", 0] },
			},
		},
		{
			// then finally, filter to only quests that pertain to this goal.
			$match: {
				"quest.questData.goals.goalID": goalSub.goalID,
			},
		},
	]);

	return dependencies;
}

/**
 * Given a goalSub, unsubscribe from it.
 *
 * On success, this will return null. On failure, this will return a failure reason.
 * For example, if this goalSub has parent quests involved that prevent its removal, it
 * will return those as an array.
 *
 * @param preventStandaloneRemoval - Some goalsubs might be marked as "standalone". These
 * goals have been explicitly and deliberately assigned by the user, and should therefore
 * only be explicitly un-assigned.
 */
export async function UnsubscribeFromGoal(
	goalSub: GoalSubscriptionDocument,
	preventStandaloneRemoval: boolean
) {
	const dependencies = await GetGoalDependencies(goalSub);

	switch (dependencies.reason) {
		case "HAS_QUEST_DEPENDENCIES":
			// never remove a goalSub if it has quests depending on it
			return dependencies;

		case "WAS_STANDALONE": {
			// only prevent standalone removal if we're told to
			if (preventStandaloneRemoval) {
				return dependencies;
			}

			break;
		}

		// no handling necessary, orphaned goals should never happen.
		case "WAS_ORPHAN":
	}

	// if we have no reason to prevent the removal, remove it.
	await db["goal-subs"].remove({
		userID: goalSub.userID,
		goalID: goalSub.goalID,
	});

	return null;
}

/**
 * Get the reason why a goal was assigned to a user.
 * This is either "WAS_STANDALONE" -- the user assigned this goal directly and deliberately
 * or "HAS_QUEST_DEPENDENCIES" -- the user was assigned this goal as the consequence
 * of a quest subscription.
 *
 * Failing that, the goal will return "WAS_ORPHAN", there's no reason this goal
 * should be subscribed to the user -- it's safe to remove for any reason.
 */
export async function GetGoalDependencies(goalSub: GoalSubscriptionDocument) {
	const parentQuests = await GetQuestSubsWhichDependOnThisGoalSub(goalSub);

	if (parentQuests.length) {
		return {
			reason: "HAS_QUEST_DEPENDENCIES",
			parentQuests,
		} as const;
	}

	if (goalSub.wasAssignedStandalone) {
		return {
			reason: "WAS_STANDALONE",
		} as const;
	}

	return { reason: "WAS_ORPHAN" } as const;
}

/**
 * For a given UGPT, unsubscribe from all their goals that no longer have any parent,
 * for example, a quest was removed, now they are left with some stranded goals that we
 * don't want to keep around.
 */
export async function UnsubscribeFromOrphanedGoalSubs(
	userID: integer,
	game: Game,
	playtype: Playtype
) {
	const goalSubs = await db["goal-subs"].find({ game, playtype, userID });

	const maybeToRemove = await Promise.all(
		goalSubs.map(async (goalSub) => {
			const deps = await GetGoalDependencies(goalSub);

			if (deps.reason === "WAS_ORPHAN") {
				return goalSub.goalID;
			}

			return null;
		})
	);

	// impressive that ts can't resolve this without a cast
	const toRemove = maybeToRemove.filter((e) => e !== null) as Array<string>;

	if (toRemove.length > 0) {
		logger.info(
			`Removing ${toRemove.length} goals from user ${userID} on ${FormatGame(
				game,
				playtype
			)} as they were orphanned.`
		);

		await db["goal-subs"].remove({
			userID,
			goalID: { $in: toRemove },
		});
	}
}

/**
 * Gets the goals the user has set for this game and playtype.
 * Then, filters it based on the chartIDs involved in this import.
 *
 * This optimisation allows users to have *lots* of goals, but only ever
 * evaluate the ones we need to.
 *
 * @param onlyUnachieved - optionally, pass "onlyUnachieved=true" to limit this to
 * only goals that the user has not achieved.
 * @returns An array of Goals, and an array of goalSubs.
 */
export async function GetRelevantGoals(
	game: Game,
	userID: integer,
	chartIDs: Set<string>,
	logger: KtLogger,
	onlyUnachieved = false
): Promise<{ goals: Array<GoalDocument>; goalSubsMap: Map<string, GoalSubscriptionDocument> }> {
	const gsQuery: FilterQuery<GoalSubscriptionDocument> = {
		game,
		userID,
	};

	if (onlyUnachieved) {
		gsQuery.achieved = false;
	}

	const goalSubs = await db["goal-subs"].find(gsQuery);

	logger.verbose(`Found user has ${goalSubs.length} goals.`);

	if (!goalSubs.length) {
		return { goals: [], goalSubsMap: new Map() };
	}

	const goalIDs = goalSubs.map((e) => e.goalID);

	const chartIDsArr: Array<string> = [];

	for (const c of chartIDs) {
		chartIDsArr.push(c);
	}

	const promises = [
		// this gets the relevantGoals for direct and multi
		db.goals.find({
			"charts.type": { $in: ["single", "multi"] },
			"charts.data": { $in: chartIDsArr },
			goalID: { $in: goalIDs },
		}),
		GetRelevantFolderGoals(goalIDs, chartIDsArr),
	];

	const goals = await Promise.all(promises).then((r) => r.flat(1));

	const goalSet = new Set(goals.map((e) => e.goalID));

	const goalSubsMap: Map<string, GoalSubscriptionDocument> = new Map();

	for (const goalSub of goalSubs) {
		if (!goalSet.has(goalSub.goalID)) {
			continue;
		}

		// since these are guaranteed to be unique, lets make a hot map of goalID -> goalSubDocument, so we can
		// pull them in for post-processing and filter out the goalSubDocuments that aren't relevant.
		goalSubsMap.set(goalSub.goalID, goalSub);
	}

	return {
		goals,
		goalSubsMap,
	};
}

/**
 * Returns the set of goals where its folder contains any member
 * of chartIDsArr.
 */
export async function GetRelevantFolderGoals(goalIDs: Array<string>, chartIDsArr: Array<string>) {
	// Slightly black magic - this is kind of like doing an SQL join.
	// it's weird to do this in mongodb, but this seems like the right
	// way to actually handle this.

	const result: Array<GoalDocument> = await db.goals.aggregate([
		{
			$match: {
				"charts.type": "folder",
				goalID: { $in: goalIDs },
			},
		},
		{
			$lookup: {
				from: "folder-chart-lookup",
				localField: "charts.data",
				foreignField: "folderID",
				as: "folderCharts",
			},
		},
		{
			$match: {
				"folderCharts.chartID": { $in: chartIDsArr },
			},
		},
		{
			$project: {
				folderCharts: 0,
				_id: 0,
			},
		},
	]);

	return result;
}

/**
 * Rarely, some sort of change might happen where a goal needs to be edited.
 *
 * This happens if the goal schema changes, but that really is quite rare.
 */
export async function EditGoal(oldGoal: GoalDocument, newGoal: GoalDocument) {
	const newGoalID = CreateGoalID(
		newGoal.charts,
		newGoal.criteria,
		newGoal.game,
		newGoal.playtype
	);

	// eslint-disable-next-line require-atomic-updates
	newGoal.goalID = newGoalID;

	await db["goal-subs"].update(
		{
			goalID: oldGoal.goalID,
		},
		{
			$set: { goalID: newGoalID },
		},
		{ multi: true }
	);

	// update any dangling quest references
	const quests = await GetQuestsThatContainGoal(oldGoal.goalID);

	for (const quest of quests) {
		const newQuestData: QuestDocument["questData"] = [];

		for (const qd of quest.questData) {
			const goals = [];

			for (const goal of qd.goals) {
				if (goal.goalID === oldGoal.goalID) {
					goals.push({ ...goal, goalID: newGoal.goalID });
				} else {
					goals.push(goal);
				}
			}

			newQuestData.push({
				...qd,
				goals,
			});
		}

		await db.quests.update(
			{ questID: quest.questID },
			{
				$set: { questData: newQuestData },
			}
		);
	}

	await db.goals.remove({ goalID: oldGoal.goalID });

	// eslint-disable-next-line require-atomic-updates
	newGoal.name = await CreateGoalName(
		newGoal.charts,
		newGoal.criteria,
		newGoal.game,
		newGoal.playtype
	);
	try {
		await db.goals.insert(newGoal);
	} catch (err) {
		logger.info(`Goal ${newGoal.name} already existed.`);
	}
}
