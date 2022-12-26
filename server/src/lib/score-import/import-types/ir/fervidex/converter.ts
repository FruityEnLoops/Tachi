import {
	InternalFailure,
	InvalidScoreFailure,
	SongOrChartNotFoundFailure,
} from "../../../framework/common/converter-failures";
import { GenericGetGradeAndPercent } from "../../../framework/common/score-utils";
import { IsNullishOrEmptyStr } from "utils/misc";
import { FindIIDXChartOnInGameIDVersion, FindIIDXChartWith2DXtraHash } from "utils/queries/charts";
import { FindSongOnID } from "utils/queries/songs";
import type { DryScore } from "../../../framework/common/types";
import type { ConverterFunction } from "../../common/types";
import type { FervidexContext, FervidexScore } from "./types";
import type { Difficulties, Lamps, Playtypes } from "tachi-common";

export const FERVIDEX_LAMP_LOOKUP = {
	0: "NO PLAY",
	1: "FAILED",
	2: "ASSIST CLEAR",
	3: "EASY CLEAR",
	4: "CLEAR",
	5: "HARD CLEAR",
	6: "EX HARD CLEAR",
	7: "FULL COMBO",
};

export function TachifyAssist(
	assist: Required<FervidexScore>["option"]["assist"]
): DryScore<"iidx:DP" | "iidx:SP">["scoreMeta"]["assist"] {
	switch (assist) {
		case "FULL_ASSIST":
		case "ASCR_LEGACY":
			return "FULL ASSIST";
		case "AUTO_SCRATCH":
			return "AUTO SCRATCH";
		case "LEGACY_NOTE":
			return "LEGACY NOTE";
		case null:
		case undefined:
			return "NO ASSIST";
	}
}

export function TachifyGauge(
	gauge: Required<FervidexScore>["option"]["gauge"]
): DryScore<"iidx:DP" | "iidx:SP">["scoreMeta"]["gauge"] {
	switch (gauge) {
		case "ASSISTED_EASY":
			return "ASSISTED EASY";
		case "EASY":
			return "EASY";
		case "EX_HARD":
			return "EX-HARD";
		case "HARD":
			return "HARD";
		case null:
		case undefined:
			return "NORMAL";
	}
}

export function TachifyRange(
	gauge: Required<FervidexScore>["option"]["range"]
): DryScore<"iidx:DP" | "iidx:SP">["scoreMeta"]["range"] {
	switch (gauge) {
		case "HIDDEN_PLUS":
			return "HIDDEN+";
		case "LIFT":
			return "LIFT";
		case "LIFT_SUD_PLUS":
			return "LIFT SUD+";
		case "SUDDEN_PLUS":
			return "SUDDEN+";
		case "SUD_PLUS_HID_PLUS":
			return "SUD+ HID+";
		case null:
		case undefined:
			return "NONE";
	}
}

export function TachifyRandom(gauge: Required<FervidexScore>["option"]["style"]) {
	switch (gauge) {
		case "RANDOM":
			return "RANDOM";
		case "S_RANDOM":
			return "S-RANDOM";
		case "R_RANDOM":
			return "R-RANDOM";
		case "MIRROR":
			return "MIRROR";
		case null:
		case undefined:
			return "NONRAN";
	}
}

export function SplitFervidexChartRef(ferDif: FervidexScore["chart"]) {
	let playtype: Playtypes["iidx"];

	if (ferDif.startsWith("sp")) {
		playtype = "SP";
	} else {
		playtype = "DP";
	}

	let difficulty: Difficulties["iidx:DP" | "iidx:SP"];

	switch (ferDif[ferDif.length - 1]) {
		case "b": {
			difficulty = "BEGINNER";
			break;
		}

		case "n": {
			difficulty = "NORMAL";
			break;
		}

		case "h": {
			difficulty = "HYPER";
			break;
		}

		case "a": {
			difficulty = "ANOTHER";
			break;
		}

		case "l": {
			difficulty = "LEGGENDARIA";
			break;
		}

		default:
			throw new InternalFailure(`Invalid fervidex difficulty of ${ferDif}`);
	}

	return { playtype, difficulty };
}

export const ConverterIRFervidex: ConverterFunction<FervidexScore, FervidexContext> = async (
	data,
	context,
	importType,
	logger
) => {
	const { difficulty, playtype } = SplitFervidexChartRef(data.chart);

	let chart;

	if (data.custom === true) {
		if (IsNullishOrEmptyStr(data.chart_sha256)) {
			throw new InvalidScoreFailure("Score has no chart_sha256 but is a custom?");
		}

		chart = await FindIIDXChartWith2DXtraHash(data.chart_sha256);
	} else {
		chart = await FindIIDXChartOnInGameIDVersion(
			data.entry_id,
			playtype,
			difficulty,
			context.version
		);
	}

	if (!chart) {
		throw new SongOrChartNotFoundFailure(
			`Could not find chart with songID ${data.entry_id} (${playtype} ${difficulty} [${context.version}])`,
			importType,
			data,
			context
		);
	}

	const song = await FindSongOnID("iidx", chart.songID);

	if (!song) {
		logger.severe(`Song ${chart.songID} (iidx) has no parent song?`);
		throw new InternalFailure(`Song ${chart.songID} (iidx) has no parent song?`);
	}

	const gaugeHistory = data.gauge.map((e) => (e > 200 ? null : e));

	const gauge = gaugeHistory[gaugeHistory.length - 1];

	// If gauge exists and is greater than 100
	// must be invalid
	if ((gauge ?? 0) > 100) {
		throw new InvalidScoreFailure(`Invalid value of gauge ${gauge}.`);
	}

	const { percent, grade } = GenericGetGradeAndPercent("iidx", data.ex_score, chart);

	let bp: number | null = data.bad + data.poor;

	if (data.dead) {
		bp = null;
	}

	const dryScore: DryScore<"iidx:DP" | "iidx:SP"> = {
		game: "iidx",
		service: "Fervidex",
		comment: null,
		importType: "ir/fervidex",
		timeAchieved: context.timeReceived,
		scoreData: {
			score: data.ex_score,
			percent,
			grade,
			lamp: FERVIDEX_LAMP_LOOKUP[data.clear_type] as Lamps["iidx:DP" | "iidx:SP"],
			judgements: {
				pgreat: data.pgreat,
				great: data.great,
				good: data.good,
				bad: data.bad,
				poor: data.poor,
			},
			hitMeta: {
				fast: data.fast,
				slow: data.slow,
				maxCombo: null,
				gaugeHistory,
				scoreHistory: data.ghost,
				gauge,
				bp,
				comboBreak: data.combo_break,
				gsm: data["2dx-gsm"],
			},
		},
		scoreMeta: {
			assist: TachifyAssist(data.option?.assist),
			gauge: TachifyGauge(data.option?.gauge),

			// @ts-expect-error Awkward expansion of iidx:SP|DP strings here causes this
			// to complain that [x,x] is not assignable to SP randoms. This is a lazy ignore!
			random:
				chart.playtype === "SP"
					? TachifyRandom(data.option?.style)
					: [TachifyRandom(data.option?.style), TachifyRandom(data.option?.style_2p)],
			range: TachifyRange(data.option?.range),
		},
	};

	return { song, chart, dryScore };
};
