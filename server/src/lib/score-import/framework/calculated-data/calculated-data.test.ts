import { CalculateDataForGamePT, CreateCalculatedData } from "./calculated-data";
import CreateLogCtx from "lib/logger/logger";
import { p } from "prudence";
import t from "tap";
import { prAssert } from "test-utils/asserts";
import {
	Testing511SPA,
	TestingDoraChart,
	TestingGITADORADoraDryScore,
	TestingIIDXSPDryScore,
	TestingSDVXSingleDryScore,
} from "test-utils/test-data";
import type { ChartDocument, ScoreDocument } from "tachi-common";

const logger = CreateLogCtx(__filename);

t.test("#CreateCalculatedData", async (t) => {
	const res = await CreateCalculatedData(TestingIIDXSPDryScore, Testing511SPA, 30, logger);

	prAssert(
		t,
		res,
		{
			ktLampRating: p.equalTo(10),
			BPI: "?number",
		},
		"Should correctly produce calculatedData"
	);

	const gitadoraRes = await CreateCalculatedData(
		TestingGITADORADoraDryScore,
		TestingDoraChart,
		30,
		logger
	);

	prAssert(
		t,
		gitadoraRes,
		{
			skill: p.isPositiveNonZero,
		},
		"Should correctly call rating function overrides for different games"
	);

	const uscRes = await CreateCalculatedData(
		{ game: "usc", playtype: "Controller" } as ScoreDocument,
		{ data: { isOfficial: false }, playtype: "Controller" } as ChartDocument,
		null,
		logger
	);

	t.strictSame(uscRes, { VF6: null }, "Should return null if chart was not an official.");

	const uscKbRes = await CreateCalculatedData(
		{ game: "usc", playtype: "Keyboard" } as ScoreDocument,
		{ data: { isOfficial: false }, playtype: "Keyboard" } as ChartDocument,
		null,
		logger
	);

	t.strictSame(
		uscKbRes,
		{ VF6: null },
		"Should return null if chart was not an official (Keyboard)."
	);

	t.end();
});

/**
 * These tests only check that the right properties are assigned.
 */
t.test("#CalculateDataForGamePT", (t) => {
	t.test("IIDX:SP", async (t) => {
		const res = await CalculateDataForGamePT(
			"iidx",
			"SP",
			Testing511SPA,
			TestingIIDXSPDryScore,
			30,

			logger
		);

		prAssert(
			t,
			res,
			{
				ktLampRating: "?number",
				BPI: "?number",
			},
			"Response should contain keys for IIDX:SP"
		);

		t.end();
	});

	t.test("IIDX:DP", async (t) => {
		const res = await CalculateDataForGamePT(
			"iidx",
			"DP",
			Testing511SPA,

			TestingIIDXSPDryScore,
			30,

			logger
		);

		prAssert(
			t,
			res,
			{
				ktLampRating: "?number",
				BPI: "?number",
			},
			"Response should contain keys for IIDX:DP"
		);

		t.end();
	});

	t.test("SDVX:Single", async (t) => {
		const res = await CalculateDataForGamePT(
			"sdvx",
			"Single",
			Testing511SPA,
			TestingSDVXSingleDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				VF6: p.nullable(p.isPositive),
			},
			"Response should contain keys for SDVX:Single"
		);

		t.end();
	});

	t.test("chunithm:Single", async (t) => {
		const res = await CalculateDataForGamePT(
			"chunithm",
			"Single",
			Testing511SPA,
			TestingIIDXSPDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				rating: "?number",
			},
			"Response should contain nulled keys for chunithm:Single"
		);

		t.end();
	});

	t.test("museca:Single", async (t) => {
		const res = await CalculateDataForGamePT(
			"museca",
			"Single",
			Testing511SPA,
			TestingIIDXSPDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				curatorSkill: "?number",
			},
			"Response should contain nulled keys for museca:Single"
		);

		t.end();
	});

	t.test("bms:7K", async (t) => {
		const res = await CalculateDataForGamePT(
			"bms",
			"7K",
			Testing511SPA,
			TestingIIDXSPDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				sieglinde: "?number",
			},
			"Response should contain nulled keys for bms:7K"
		);

		t.end();
	});

	t.test("bms:14K", async (t) => {
		const res = await CalculateDataForGamePT(
			"bms",
			"14K",
			Testing511SPA,
			TestingIIDXSPDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				sieglinde: "?number",
			},
			"Response should contain nulled keys for bms:14K"
		);

		t.end();
	});

	t.test("gitadora:Gita", async (t) => {
		const res = await CalculateDataForGamePT(
			"gitadora",
			"Gita",
			Testing511SPA,
			TestingIIDXSPDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				skill: "?number",
			},
			"Response should contain nulled keys for gitadora:Gita"
		);

		t.end();
	});

	t.test("gitadora:Dora", async (t) => {
		const res = await CalculateDataForGamePT(
			"gitadora",
			"Dora",
			Testing511SPA,
			TestingIIDXSPDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				skill: "?number",
			},
			"Response should contain nulled keys for gitadora:Dora"
		);

		t.end();
	});

	t.test("usc:Controller", async (t) => {
		const res = await CalculateDataForGamePT(
			"usc",
			"Controller",
			Testing511SPA,
			TestingIIDXSPDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				VF6: "?number",
			},
			"Response should contain nulled keys for usc:Controller"
		);

		t.end();
	});

	t.test("usc:Keyboard", async (t) => {
		const res = await CalculateDataForGamePT(
			"usc",
			"Keyboard",
			Testing511SPA,
			TestingIIDXSPDryScore,
			null,
			logger
		);

		prAssert(
			t,
			res,
			{
				VF6: "?number",
			},
			"Response should contain nulled keys for usc:Keyboard"
		);

		t.end();
	});

	t.end();
});
