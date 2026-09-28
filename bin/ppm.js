#!/usr/bin/env node

"use strict";

const { buildRegistry } = require("./createOperation");
const setupOps = require("./commands/setup/operation");
const taskOps = require("./commands/task/operation");

const { byName, usages } = buildRegistry([...setupOps, ...taskOps]);

function usageText() {
	return ["Usage:", ...usages, "", "Compatibility: plan_init remains an alias for init --plan."].join("\n");
}

const BOOLEAN_OPTIONS = new Set(["dry-run", "force", "replace", "strict"]);
// Free-text options may legitimately start with "--"; every other value must not.
const FREE_TEXT_OPTIONS = new Set(["progress-text"]);

function parseOptions(argv, allowed) {
	const opts = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
		const key = token.slice(2);
		if (!allowed.includes(key)) throw new Error(`unknown option: ${token}`);
		if (opts[key] !== undefined) throw new Error(`duplicate option: ${token}`);
		if (BOOLEAN_OPTIONS.has(key)) {
			opts[key] = true;
			continue;
		}
		const value = argv[index + 1];
		if (value === undefined || (value.startsWith("--") && !FREE_TEXT_OPTIONS.has(key))) throw new Error(`missing value for ${token}`);
		opts[key] = value;
		index += 1;
	}
	return opts;
}

function parseArgs(argv) {
	const name = argv[0];
	const op = byName.get(name);
	if (!op) throw new Error(`unknown or missing operation\n${usageText()}`);
	// Scoped usage: an error on a known op prints only that op's usage line, not the full list.
	let options;
	try { options = parseOptions(argv.slice(1), op.options); } catch (error) { throw new Error(`${error.message}\nUsage: ${op.usage}`); }
	for (const required of op.required)
		if (!options[required]) throw new Error(`missing --${required}\nUsage: ${op.usage}`);
	for (const validate of Object.values(op.validators)) validate(options);
	return { operation: name, options };
}

try {
	const { operation, options } = parseArgs(process.argv.slice(2));
	byName.get(operation).handler(options);
} catch (error) {
	process.stderr.write(`Error: ${error.message}\n`);
	process.exitCode = 1;
}