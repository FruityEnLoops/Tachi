import ScoreImportFatalError from "../../../framework/score-importing/score-import-error";
import { p } from "prudence";
import { FormatPrError } from "utils/prudence";
import type { ParserFunctionReturns } from "../../common/types";
import type { MerScore } from "./types";
import type { KtLogger } from "lib/logger/logger";
import type { EmptyObject } from "utils/types";

const PR_MER_IIDX = {
	music_id: p.isPositiveInteger,
	play_type: p.isIn("SINGLE", "DOUBLE"),
	diff_type: p.isIn("NORMAL", "HYPER", "ANOTHER", "LEGGENDARIA", "BEGINNER"),
	score: p.isPositiveInteger,
	miss_count: p.or(p.isPositiveInteger, p.is(-1)),
	clear_type: p.isIn(
		"NO PLAY",
		"FAILED",
		"ASSIST CLEAR",
		"EASY CLEAR",
		"CLEAR",
		"HARD CLEAR",
		"EX HARD CLEAR",
		"FULLCOMBO CLEAR"
	),
	update_time: "string",
};

export function ParseMerIIDX(
	fileData: Express.Multer.File,
	body: Record<string, unknown>,
	logger: KtLogger
): ParserFunctionReturns<MerScore, EmptyObject> {
	let jsonData;

	try {
		jsonData = JSON.parse(fileData.buffer.toString("utf-8")) as unknown;
	} catch (err) {
		logger.info((err as Error).message);
		throw new ScoreImportFatalError(400, "Invalid JSON.");
	}

	if (!Array.isArray(jsonData)) {
		throw new ScoreImportFatalError(400, `Invalid MER-IIDX JSON: Expected Top-Level Array.`);
	}

	// this is because prudence doesn't support top level arrays at the moment.
	for (let i = 0; i < jsonData.length; i++) {
		const err = p(jsonData[i], PR_MER_IIDX, {}, { allowExcessKeys: true });

		if (err) {
			throw new ScoreImportFatalError(400, `${FormatPrError(err)} [Index ${i}]`);
		}
	}

	return {
		classHandler: null,
		context: {},
		iterable: jsonData as Array<MerScore>,
		game: "iidx",
	};
}
