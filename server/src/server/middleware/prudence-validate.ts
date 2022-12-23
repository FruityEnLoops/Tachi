import CreateLogCtx from "lib/logger/logger";
import { p } from "prudence";
import type { RequestHandler } from "express-serve-static-core";
import type {
	ErrorMessages,
	MiddlewareErrorHandler,
	PrudenceOptions,
	PrudenceSchema,
} from "prudence";

const logger = CreateLogCtx(__filename);

export const PrudenceErrorFormatter = (
	message: string,
	stringVal: string | null,
	keychain: string | null
) => `[${keychain}] ${message}${stringVal ? ` (Received ${stringVal})` : ""}`;

const API_ERR_HANDLER =
	(logLevel: TachiLogLevels): MiddlewareErrorHandler =>
	(req, res, next, error) => {
		let stringVal = error.userVal;

		if (error.keychain?.startsWith("!") === true && error.userVal !== undefined) {
			stringVal = "****";
		}

		if (typeof stringVal === "object" && stringVal !== null) {
			// this is probably null-prototype
			stringVal = null;
		} else if (stringVal === undefined) {
			stringVal = "nothing (undefined)";
		} else {
			stringVal = String(stringVal);
		}

		logger[logLevel](
			`Prudence rejection: ${error.message}, ${stringVal} [K:${error.keychain}]`,
			{
				userVal: error.userVal,
				fullObj: req.method === "GET" ? req.query : req.safeBody,
			}
		);

		return res.status(400).json({
			success: false,
			description: PrudenceErrorFormatter(
				error.message,
				stringVal as string | null,
				error.keychain
			),
		});
	};

// Cache all of the possible API_ERROR_HANDLERS to avoid function creation
// overhead at runtime.
const API_ERROR_HANDLERS = Object.fromEntries(
	(["crit", "severe", "error", "warn", "info", "verbose", "debug"] as const).map((e) => [
		e,
		API_ERR_HANDLER(e),
	])
) as Record<TachiLogLevels, MiddlewareErrorHandler>;

type TachiLogLevels = "crit" | "debug" | "error" | "info" | "severe" | "verbose" | "warn";

const prValidate = (
	s: PrudenceSchema,
	errorMessage?: ErrorMessages,
	options?: Partial<PrudenceOptions>,
	level: TachiLogLevels = "info"
): RequestHandler => p.CurryMiddleware(API_ERROR_HANDLERS[level])(s, errorMessage, options);

export default prValidate;
