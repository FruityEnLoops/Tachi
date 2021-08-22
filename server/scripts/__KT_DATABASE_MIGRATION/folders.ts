/* eslint-disable @typescript-eslint/no-explicit-any */

import { FolderDocument, Game } from "tachi-common";
import { validPlaytypes, gameHuman } from "tachi-common/js/config";
import db from "external/mongo/db";
import CreateLogCtx from "../../src/common/logger";
import MigrateRecords from "./migrate";
import crypto from "crypto";

const logger = CreateLogCtx(__filename);

function ConvertFn(c: any): FolderDocument[] {
	throw new Error("This doesn't work, It was migrated elsewhere.");

	// let docs = [];

	// for (const playtype of validPlaytypes[c.game as Game]) {
	//     const fd: FolderDocument = {
	//         title: c.title,
	//         game: c.game,
	//         playtype,
	//         type: "query" as const,
	//         query: {
	//             collection: c.query.collection,
	//             body: c.query.query,
	//         },
	//         folderID: crypto.randomBytes(20).toString("hex"),
	//         table: c.table,
	//         tableIndex: 0, // ???
	//     };

	//     let gh = gameHuman[c.game as Game];

	//     fd.title = fd.title.replace(new RegExp(`${gh} +`, "giu"), "");

	//     logger.info(`Porting folder ${fd.title} (${playtype})`);

	//     docs.push(fd);
	// }

	// return docs;
}

(async () => {
	await MigrateRecords(db.folders, "folders", ConvertFn);

	process.exit(0);
})();
