import QuickTooltip from "components/layout/misc/QuickTooltip";
import MiniTable from "components/tables/components/MiniTable";
import ApiError from "components/util/ApiError";
import ExternalLink from "components/util/ExternalLink";
import Icon from "components/util/Icon";
import Loading from "components/util/Loading";
import Muted from "components/util/Muted";
import useApiQuery from "components/util/query/useApiQuery";
import { UserContext } from "context/UserContext";
import { AllLUGPTStatsContext } from "context/AllLUGPTStatsContext";
import React, { useContext } from "react";
import { Col, Row } from "react-bootstrap";
import { Link } from "react-router-dom";
import { ChartDocument, FolderDocument, Game, GetGamePTConfig } from "tachi-common";
import { GamePT } from "types/react";

export default function ChartInfoFormat({
	chart,
	game,
	playtype,
}: { chart: ChartDocument } & GamePT) {
	const gptConfig = GetGamePTConfig(game, playtype);

	const withTierlists = gptConfig.tierlists.filter((e) => chart.tierlistInfo[e]);

	const { data, error } = useApiQuery<FolderDocument[]>(
		`/games/${game}/${playtype}/charts/${chart.chartID}/folders`
	);

	const { user } = useContext(UserContext);
	const { ugs } = useContext(AllLUGPTStatsContext);

	if (error) {
		<ApiError error={error} />;
	}

	if (!data) {
		return <Loading />;
	}

	return (
		<Row
			className="text-center align-items-center"
			style={{
				paddingTop: "2.2rem",
				justifyContent: "space-evenly",
			}}
		>
			<Col xs={12} lg={3}>
				<h4>Appears In</h4>
				{data.length !== 0 ? (
					data.map((e) => (
						<li key={e.folderID}>
							{user && ugs ? (
								<Link
									className="gentle-link"
									to={`/u/${user.username}/games/${game}/${playtype}/folders/${e.folderID}`}
								>
									{e.title}
								</Link>
							) : (
								<span>{e.title}</span>
							)}
						</li>
					))
				) : (
					<Muted>No folders...</Muted>
				)}
			</Col>
			<Col xs={12} lg={4}>
				<ChartInfoMiddle chart={chart} game={game} />
			</Col>
			<Col xs={12} lg={3}>
				{withTierlists.length !== 0 ? (
					<MiniTable headers={["Tierlist Info"]} colSpan={2}>
						{withTierlists.map((e) => (
							<tr key={e}>
								<td>{e}</td>
								<td>
									{chart.tierlistInfo[e]!.text}{" "}
									<Muted>({chart.tierlistInfo[e]!.value.toFixed(2)})</Muted>
									{chart.tierlistInfo[e]!.individualDifference && (
										<>
											<br />
											<QuickTooltip tooltipContent="Individual Difference - The difficulty of this varies massively between people!">
												<span>
													<Icon type="balance-scale-left" />
												</span>
											</QuickTooltip>
										</>
									)}
								</td>
							</tr>
						))}
					</MiniTable>
				) : (
					<Muted>No tierlist info.</Muted>
				)}
			</Col>
		</Row>
	);
}

function ChartInfoMiddle({ game, chart }: { chart: ChartDocument; game: Game }) {
	if (game === "bms") {
		const bmsChart = chart as ChartDocument<"bms:7K" | "bms:14K">;

		return (
			<>
				<ExternalLink
					href={`http://www.ribbit.xyz/bms/score/view?md5=${bmsChart.data.hashMD5}`}
				>
					View Chart on Ribbit
				</ExternalLink>
				<br />
				<ExternalLink
					href={`http://www.dream-pro.info/~lavalse/LR2IR/search.cgi?&bmsmd5=${bmsChart.data.hashMD5}`}
				>
					View on LR2IR
				</ExternalLink>
			</>
		);
	} else if (game === "pms") {
		const pmsChart = chart as ChartDocument<"pms:Controller" | "pms:Keyboard">;

		return (
			<>
				<ExternalLink
					href={`http://www.dream-pro.info/~lavalse/LR2IR/search.cgi?&bmsmd5=${pmsChart.data.hashMD5}`}
				>
					View on LR2IR
				</ExternalLink>
			</>
		);
	}

	return <></>;
}
