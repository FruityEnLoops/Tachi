import { Command } from "commander";
import CreateLogCtx from "lib/logger/logger";
import monk from "monk";
import { execSync } from "child_process";

const program = new Command();

program
	.option("--nsFrom <Database to clone from.>")
	.option("--nsTo <Database to clone and anonymise to. Must begin with anon->");

program.parse(process.argv);
const options: { nsTo?: string; nsFrom?: string } = program.opts();

if (!options.nsTo || !options.nsFrom) {
	throw new Error(`Expected --nsFrom and --nsTo options.`);
}

const logger = CreateLogCtx(__filename);

/**
 * Strips all name and private information from the database.
 * For use for things like future tachi-db-dumps?
 *
 * @param nsTo The database to anonymise. DO NOT PASS THE PRODUCTION DATABASE TO THIS!
 */
async function AnonymiseDB(nsTo: string) {
	logger.info(`Connecting to ${nsTo}.`);

	const clonedDB = monk(`127.0.0.1/${nsTo}`);

	logger.info(`Connected to ${nsTo}.`);

	const r1 = await clonedDB.get("user-private-information").update(
		{},
		[
			{
				$set: {
					// This is "password" encrypted in bcrypt12.
					password: "$2b$12$QRFCAxvFoNI2spszFPgt/e.qLy55GvYWlSHioa0AujRbFpChLwHmu",

					// emails are uniquely indexed. We need to anonymise these in
					// a way that they dont duplicate.
					email: { $concat: [{ $toString: "$userID" }, "@example.com"] },
				},
			},
		],
		{
			multi: true,
		}
	);

	logger.info(`Stripped private info.`, { r1 });

	const r2 = await clonedDB.get("users").update(
		{},
		[
			{
				$set: {
					socialMedia: { $const: {} },
				},
			},
			{
				$set: {
					username: { $concat: ["u", { $toString: "$id" }] },
					usernameLowercase: { $concat: ["u", { $toString: "$id" }] },
				},
			},
		],
		{
			multi: true,
		}
	);

	logger.info(`Stripped username info.`, { r2 });

	for (const collection of [
		"api-clients",
		"oauth2-auth-codes",
		"password-reset-codes",
		"api-tokens",
		"kai-auth-tokens",
	]) {
		// eslint-disable-next-line no-await-in-loop
		const r3 = await clonedDB.get("collection").remove({});

		logger.info(`Removed all ${collection} documents.`, { r3 });
	}

	logger.info(`Done! Closing.`);

	process.exit(0);
}

function CloneDB(nsFrom: string, nsTo: string) {
	logger.info(`Cloning Database. This will take a while.`);
	execSync(`mongodump --gzip --archive=temp-dump --db=${nsFrom}`);
	execSync(`mongorestore --archive=temp-dump --gzip --nsFrom='${nsFrom}.*' --nsTo='${nsTo}.*'`);
	execSync(`rm temp-dump`);
	logger.info(`Cloned!`);
}

if (require.main === module) {
	if (!options.nsTo.startsWith("anon-")) {
		logger.error(
			`Tried to clone to and anonymise ${options.nsTo}, which is illegal. Anonymised DBs must start with anon-.`,
			() => {
				process.exit(1);
			}
		);
	} else {
		// else guard here is important, as the above statement doesn't immediately halt
		// execution
		// -- return isn't valid at top level, and i can't be bothered wrapping this in
		// a useless fn.
		CloneDB(options.nsFrom, options.nsTo);

		// Don't run any risks -- there's no way we're ever accidentally anonymising the production database.
		// any nsTo argument MUST start with anon-

		if (options.nsTo.startsWith("anon-")) {
			AnonymiseDB(options.nsTo)
				.then(() => {
					logger.info(`Anonymised database successfully. Saved to ${options.nsTo}.`);
					process.exit(0);
				})
				.catch((err: unknown) => {
					logger.error(`Failed to anonymise database.`, { err }, () => {
						process.exit(1);
					});
				});
		}
	}
}
