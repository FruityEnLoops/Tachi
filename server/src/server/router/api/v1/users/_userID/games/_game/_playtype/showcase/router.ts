import { Router } from "express";
import db from "external/mongo/db";
import { EvaluateShowcaseStat } from "lib/showcase/evaluator";
import { GetRelatedStatDocuments } from "lib/showcase/get-related";
import { EvaluateUsersStatsShowcase } from "lib/showcase/get-stats";
import { p } from "prudence";
import { RequirePermissions } from "server/middleware/auth";
import { RequireAuthedAsUser } from "server/router/api/v1/users/_userID/middleware";
import { FormatGame, GetGPTString, GetGamePTConfig, GetScoreMetrics } from "tachi-common";
import { IsRecord } from "utils/misc";
import { FormatPrError } from "utils/prudence";
import { GetUGPT } from "utils/req-tachi-data";
import { ResolveUser } from "utils/user";
import type { ShowcaseStatDetails } from "tachi-common";

const router: Router = Router({ mergeParams: true });

/**
 * Evaluate this users set stats.
 *
 * @param projectUser - Project another user's stats instead of their set stats.
 *
 * @name GET /api/v1/users/:userID/games/:game/:playtype/showcase
 */
router.get("/", async (req, res) => {
	const { user, game, playtype } = GetUGPT(req);

	let projectUser;

	if (typeof req.query.projectUser === "string") {
		const user = await ResolveUser(req.query.projectUser);

		if (!user) {
			return res.status(404).json({
				success: false,
				description: `The projected user ${req.query.projectUser} does not exist.`,
			});
		}

		projectUser = user.id;
	}

	const results = await EvaluateUsersStatsShowcase(user.id, game, playtype, projectUser);

	return res.status(200).json({
		success: true,
		description: `Evaluated ${results.length} stats.`,
		body: results,
	});
});

/**
 * Evalulate a custom stat on this user.
 *
 * @param mode - "folder" or "chart"
 * @param metric - "any score metric for this game (i.e. non-optional).
 * Also, "playcount" if mode is chart.
 * @param chartID - If mode is "chart" this must contain the chartID the stat is referencing.
 * @param folderID - If mode is "folder" this must contain the folderID the stat is referencing.
 * @param gte - If mode is "folder" this must contain the value the metric must be greater than.
 *
 * @name GET /api/v1/users/:userID/games/:game/:playtype/showcase/custom
 */
router.get("/custom", async (req, res) => {
	const { user, game, playtype } = GetUGPT(req);

	const gptConfig = GetGamePTConfig(game, playtype);

	let stat: ShowcaseStatDetails;

	const availableMetrics = GetScoreMetrics(gptConfig, ["DECIMAL", "ENUM", "INTEGER"]);

	if (req.query.mode === "folder") {
		const err = p(
			req.query,
			{
				mode: p.is("folder"),
				metric: p.isIn(availableMetrics),
				folderID: "string",

				// lazy regex for matching strings that look like numbers
				gte: p.regex(/^[0-9]*(.[0-9])?$/u),
			},
			{},
			{ allowExcessKeys: true }
		);

		if (err) {
			return res.status(400).json({
				success: false,
				description: FormatPrError(err, "Invalid folder stat"),
			});
		}

		const folderID = req.query.folderID as string;

		const folder = await db.folders.findOne({ folderID });

		if (!folder || folder.game !== game || folder.playtype !== playtype) {
			return res.status(400).json({
				success: false,
				description: `Invalid folderID - all folders must be for ${FormatGame(
					game,
					playtype
				)}, and exist.`,
			});
		}

		stat = {
			mode: "folder",
			metric: req.query.metric as string,
			folderID,
			gte: Number(req.query.gte),
		};
	} else if (req.query.mode === "chart") {
		const err = p(
			req.query,
			{
				mode: p.is("chart"),
				metric: p.isIn(...availableMetrics, "playcount"),
				chartID: "string",
			},
			{},
			{ allowExcessKeys: true }
		);

		if (err) {
			return res.status(400).json({
				success: false,
				description: FormatPrError(err, "Invalid chart stat"),
			});
		}

		const chart = await db.anyCharts[game].findOne({ chartID: req.query.chartID as string });

		if (!chart || chart.playtype !== playtype) {
			return res.status(400).json({
				success: false,
				description: `Chart does not exist, or is not for this game and playtype.`,
			});
		}

		stat = {
			mode: "chart",
			metric: req.query.metric as string,
			chartID: req.query.chartID as string,
		};
	} else {
		return res.status(400).json({
			success: false,
			description: `Invalid stat mode - expected either 'chart' or 'folder'.`,
		});
	}

	const gpt = GetGPTString(game, playtype);

	const result = await EvaluateShowcaseStat(gpt, stat, user.id);

	const related = await GetRelatedStatDocuments(stat, game);

	return res.status(200).json({
		success: true,
		description: `Evaluated Stat for ${user.username}`,
		body: { stat, result, related },
	});
});

/**
 * Replaces a user's stat showcase.
 *
 * @name PUT /api/v1/users/:userID/games/:game/:playtype/showcase
 */
router.put("/", RequireAuthedAsUser, RequirePermissions("customise_profile"), async (req, res) => {
	const { user, game, playtype } = GetUGPT(req);

	const gptConfig = GetGamePTConfig(game, playtype);

	if (!Array.isArray(req.safeBody)) {
		return res.status(400).json({
			success: false,
			description: `No stats provided, or was not an array.`,
		});
	}

	if (req.safeBody.length > 6) {
		return res.status(400).json({
			success: false,
			description: `You are only allowed 6 stats at once.`,
		});
	}

	const stats = req.safeBody as Array<unknown>;

	const availableMetrics = GetScoreMetrics(gptConfig, ["DECIMAL", "ENUM", "INTEGER"]);

	for (const unvalidatedStat of stats) {
		let err;

		if (!IsRecord(unvalidatedStat)) {
			return res.status(400).json({
				success: false,
				description: `Invalid stat -- got null or a non-object.`,
			});
		}

		if (unvalidatedStat.mode === "chart") {
			err = p(unvalidatedStat, {
				chartID: "string",
				mode: p.is("chart"),
				metric: p.isIn(...availableMetrics, "playcount"),
			});
		} else if (unvalidatedStat.mode === "folder") {
			err = p(unvalidatedStat, {
				folderID: (self) => {
					if (typeof self === "string") {
						return true;
					} else if (Array.isArray(self)) {
						return self.length <= 6 && self.every((r) => typeof r === "string");
					}

					return false;
				},
				mode: p.is("folder"),
				metric: p.isIn(availableMetrics),

				gte: (self, parent) => {
					if (typeof self !== "number") {
						return "Expected a number.";
					}

					if (typeof parent.metric !== "string") {
						return `Expected parent.metric to be a string.`;
					}

					const conf =
						gptConfig.providedMetrics[parent.metric] ??
						gptConfig.derivedMetrics[parent.metric];

					if (!conf) {
						return `Invalid metric ${
							parent.metric
						}, Expected any of ${availableMetrics.join(", ")}.`;
					}

					if (conf.type === "ENUM") {
						return p.isBoundedInteger(0, conf.values.length - 1)(self);
					}

					if (conf.type === "GRAPH" || conf.type === "NULLABLE_GRAPH") {
						return "Cannot set a showcase stat for this metric.";
					}

					if (conf.chartDependentMax) {
						return `Cannot set a folder showcase goal for this metric as it is chart dependent.`;
					}

					return conf.validate(self);
				},
			});
		} else {
			return res.status(400).json({
				success: false,
				description: `Invalid stat - Expected mode to be 'chart' or 'folder').`,
			});
		}

		if (err) {
			return res.status(400).json({
				success: false,
				description: FormatPrError(err, "Invalid stat."),
			});
		}

		const stat = unvalidatedStat as unknown as ShowcaseStatDetails;

		if (stat.mode === "chart") {
			// eslint-disable-next-line no-await-in-loop
			const chart = await db.anyCharts[game].findOne({ chartID: stat.chartID });

			if (!chart || chart.playtype !== playtype) {
				return res.status(400).json({
					success: false,
					description: `Invalid chartID - must be a chart for this game and playtype.`,
				});
			}
		} else if (unvalidatedStat.mode === "folder") {
			const folderIDs = Array.isArray(unvalidatedStat.folderID)
				? unvalidatedStat.folderID
				: [unvalidatedStat.folderID];

			// eslint-disable-next-line no-await-in-loop
			const folders = await db.folders.find({ folderID: { $in: folderIDs } });

			if (
				folders.length !== folderIDs.length ||
				!folders.every((r) => r.game === game && r.playtype === playtype)
			) {
				return res.status(400).json({
					success: false,

					// this error message is kinda lazy.
					description: `Invalid folderID - must be a folder for this game and playtype.`,
				});
			}
		}
	}

	await db["game-settings"].update(
		{
			userID: user.id,
			game,
			playtype,
		},
		{
			$set: {
				"preferences.stats": req.safeBody,
			},
		}
	);

	const newSettings = await db["game-settings"].findOne({
		userID: user.id,
		game,
		playtype,
	});

	return res.status(200).json({
		success: true,
		description: `Updated stat showcase.`,
		body: newSettings,
	});
});

export default router;
