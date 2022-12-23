import { GetScoreFromParam, RequireOwnershipOfScoreOrAdmin } from "./middleware";
import { Router } from "express";
import db from "external/mongo/db";
import CreateLogCtx from "lib/logger/logger";
import { DeleteScore } from "lib/score-mutation/delete-scores";
import { p } from "prudence";
import { RequirePermissions } from "server/middleware/auth";
import prValidate from "server/middleware/prudence-validate";
import { GetTachiData } from "utils/req-tachi-data";
import { GetUserWithID } from "utils/user";

const router: Router = Router({ mergeParams: true });

const logger = CreateLogCtx(__filename);

router.use(GetScoreFromParam);

/**
 * Retrieve the score document at this ID.
 *
 * @param getRelated - Gets the related song and chart document for this score, aswell.
 *
 * @name GET /api/v1/scores/:scoreID
 */
router.get("/", async (req, res) => {
	const score = GetTachiData(req, "scoreDoc");

	if (req.query.getRelated !== undefined) {
		const [user, chart, song] = await Promise.all([
			GetUserWithID(score.userID),
			db.charts[score.game].findOne({ chartID: score.chartID }),
			db.songs[score.game].findOne({ id: score.songID }),
		]);

		if (!user || !chart || !song) {
			logger.error(
				`Score ${
					score.scoreID
				} refers to non-existent data: [user,chart,song] [${!!user} ${!!chart} ${!!song}]`
			);

			return res.status(500).json({
				success: false,
				description: `An internal server error has occured.`,
			});
		}

		return res.status(200).json({
			success: true,
			description: `Returned score.`,
			body: {
				score,
				user,
				song,
				chart,
			},
		});
	}

	return res.status(200).json({
		success: true,
		description: `Returned score.`,
		body: {
			score,
		},
	});
});

interface ModifiableScoreProps {
	comment?: string | null;
	highlight?: boolean;
}

/**
 * Modifies a score.
 *
 * Requires you to be the owner of this score, and have the modify_scores permission.
 *
 * @name PATCH /api/v1/scores/:scoreID
 */
router.patch(
	"/",
	RequireOwnershipOfScoreOrAdmin,
	RequirePermissions("customise_score"),
	prValidate({
		comment: p.optional(p.nullable(p.isBoundedString(1, 120))),
		highlight: "*boolean",
	}),
	async (req, res) => {
		const body = req.safeBody as {
			comment?: string | null;
			highlight?: boolean;
		};

		const score = GetTachiData(req, "scoreDoc");

		const modifyOption: ModifiableScoreProps = {};

		if (body.comment !== undefined) {
			modifyOption.comment = body.comment;
		}

		if (body.highlight !== undefined) {
			modifyOption.highlight = body.highlight;
		}

		if (Object.keys(modifyOption).length === 0) {
			return res.status(400).json({
				success: false,
				description: `This request modifies nothing about the score.`,
			});
		}

		const newScore = await db.scores.findOneAndUpdate(
			{ scoreID: score.scoreID },
			{ $set: modifyOption }
		);

		if (modifyOption.highlight === true || modifyOption.highlight === false) {
			await db["personal-bests"].findOneAndUpdate(
				{
					chartID: score.chartID,
					userID: score.userID,
				},
				{
					$set: {
						highlight: modifyOption.highlight,
					},
				}
			);
		}

		return res.status(200).json({
			success: true,
			description: `Updated score.`,
			body: newScore,
		});
	}
);

/**
 * Deletes the score.
 *
 * @param blacklist - Whether to blacklist this scoreID or not.
 * A blacklisted score will never be reimported.
 *
 * @name DELETE /api/v1/scores/:scoreID
 */
router.delete(
	"/",
	RequireOwnershipOfScoreOrAdmin,
	prValidate({ blacklist: "*boolean" }),
	RequirePermissions("delete_score"),
	async (req, res) => {
		const body = req.safeBody as {
			blacklist?: boolean;
		};

		const score = GetTachiData(req, "scoreDoc");

		await DeleteScore(score, body.blacklist);

		return res.status(200).json({
			success: true,
			description: `Successfully deleted score.`,
			body: {},
		});
	}
);

export default router;
