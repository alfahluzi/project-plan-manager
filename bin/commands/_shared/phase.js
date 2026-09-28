"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { PLAN_PATTERN, PHASE_PATTERN, VALID_STATUSES, VALID_AGENTS } = require("./patterns");

const LOCK_TIMEOUT_MS = 10000;
const LOCK_STALE_MS = 30000;

function phaseNumber(name) {
	const match = /^phase_(\d+)$/.exec(name);
	return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

// Phase names under <planRoot>/tasks, ordered numerically (phase_2 before phase_10).
function listPhaseNames(planRoot) {
	let entries;
	try { entries = fs.readdirSync(path.join(planRoot, "tasks"), { withFileTypes: true }); } catch (error) {
		if (error.code === "ENOENT") return [];
		throw error;
	}
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json") && PHASE_PATTERN.test(entry.name.slice(0, -5)))
		.map((entry) => entry.name.slice(0, -5))
		.sort((a, b) => phaseNumber(a) - phaseNumber(b) || a.localeCompare(b));
}

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Exclusive lock around read-modify-write of one phase file, so parallel lanes don't lose updates.
// ponytail: O_EXCL lockfile + stale timeout; swap for proper flock if multi-host FS is ever needed.
function withFileLock(file, fn) {
	const lock = `${file}.lock`;
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	for (;;) {
		try {
			fs.closeSync(fs.openSync(lock, "wx"));
			break;
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			try {
				if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; }
			} catch (statError) { if (statError.code !== "ENOENT") throw statError; continue; }
			if (Date.now() > deadline) throw new Error(`timed out waiting for lock: ${lock}`);
			sleep(25 + Math.floor(Math.random() * 25));
		}
	}
	try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
}

function assertSafeSegment(value, label, pattern) {
	if (!pattern.test(value) || value === "." || value === "..") throw new Error(`invalid ${label}: ${value}`);
}

function projectRoot(options) {
	const candidate = path.resolve(options.project || process.cwd());
	let stat;
	try {
		stat = fs.statSync(candidate);
	} catch (error) {
		if (error.code === "ENOENT") throw new Error(`project directory not found: ${candidate}`);
		throw error;
	}
	if (!stat.isDirectory()) throw new Error(`project path is not a directory: ${candidate}`);
	return fs.realpathSync(candidate);
}

function readPhase(taskFile, expectedPhase) {
	let content;
	try { content = fs.readFileSync(taskFile, "utf8"); } catch (error) {
		if (error.code === "ENOENT") throw new Error(`task file not found: ${taskFile}`);
		throw error;
	}
	let phase;
	try { phase = JSON.parse(content); } catch (error) { throw new Error(`invalid JSON in ${taskFile}: ${error.message}`); }
	// Legacy normalization. fail_desc is folded into progress (not dropped) so no failure context is lost.
	if (Array.isArray(phase?.tasks)) {
		for (const task of phase.tasks) {
			if (!task || typeof task !== "object") continue;
			if (task.progress === undefined) task.progress = "";
			if (task.status === "start") task.status = "todo";
			if ("fail_desc" in task) {
				const legacy = typeof task.fail_desc === "string" ? task.fail_desc.trim() : "";
				if (legacy && typeof task.progress === "string" && !task.progress.includes(legacy))
					task.progress = [task.progress.trim(), `[legacy fail_desc] ${legacy}`].filter(Boolean).join("\n");
				delete task.fail_desc;
			}
		}
	}
	validatePhase(phase, expectedPhase);
	return phase;
}

function validatePreRequest(task, index, ids) {
	if (!("pre_request" in task)) return;
	const label = `tasks[${index}].pre_request`;
	if (!Array.isArray(task.pre_request)) throw new Error(`${label} must be an array of task ids`);
	const seen = new Set();
	for (const dep of task.pre_request) {
		if (typeof dep !== "string" || !dep.trim()) throw new Error(`${label} entries must be non-empty strings`);
		if (dep === task.id) throw new Error(`${label} cannot reference the task itself: ${dep}`);
		if (!ids.has(dep)) throw new Error(`${label} references unknown task id in same phase: ${dep}`);
		if (seen.has(dep)) throw new Error(`${label} contains duplicate entry: ${dep}`);
		seen.add(dep);
	}
}

function detectCycles(phase) {
	const deps = new Map();
	for (const task of phase.tasks) deps.set(task.id, Array.isArray(task.pre_request) ? task.pre_request : []);
	const WHITE = 0, GRAY = 1, BLACK = 2;
	const color = new Map();
	const stack = [];
	const visit = (id) => {
		if (color.get(id) === GRAY) {
			const cycleStart = stack.indexOf(id);
			const cycle = [...stack.slice(cycleStart), id].join(" -> ");
			throw new Error(`pre_request cycle detected: ${cycle}`);
		}
		if (color.get(id) === BLACK) return;
		color.set(id, GRAY);
		stack.push(id);
		for (const dep of deps.get(id) || []) visit(dep);
		stack.pop();
		color.set(id, BLACK);
	};
	for (const id of deps.keys()) color.set(id, WHITE);
	for (const id of deps.keys()) if (color.get(id) === WHITE) visit(id);
}

// Optional ownership list: repo-relative paths, dirs (trailing "/"), or globs (*, **, ?).
function validateFiles(task, index) {
	if (!("files" in task)) return;
	const label = `tasks[${index}].files`;
	if (!Array.isArray(task.files)) throw new Error(`${label} must be an array of repo-relative paths or globs`);
	const seen = new Set();
	for (const entry of task.files) {
		if (typeof entry !== "string" || !entry.trim()) throw new Error(`${label} entries must be non-empty strings`);
		if (path.isAbsolute(entry) || /^[A-Za-z]:/.test(entry)) throw new Error(`${label} must be repo-relative: ${entry}`);
		if (entry.split(/[\\/]/).includes("..")) throw new Error(`${label} must not contain "..": ${entry}`);
		if (seen.has(entry)) throw new Error(`${label} contains duplicate entry: ${entry}`);
		seen.add(entry);
	}
}

function validateAgent(task, index) {
	if (!("agent" in task)) return;
	if (!VALID_AGENTS.has(task.agent)) throw new Error(`tasks[${index}].agent must be one of ${[...VALID_AGENTS].join("|")}: ${task.agent}`);
}

function validatePhase(phase, expectedPhase) {
	if (!phase || typeof phase !== "object" || Array.isArray(phase)) throw new Error("phase file root must be an object");
	if (phase.phase !== expectedPhase) throw new Error(`phase field must equal ${expectedPhase}`);
	if (!Array.isArray(phase.tasks)) throw new Error("tasks must be an array");
	const ids = new Set();
	phase.tasks.forEach((task, index) => {
		const label = `tasks[${index}]`;
		if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error(`${label} must be an object`);
		for (const field of ["id", "title", "detail", "status"]) if (typeof task[field] !== "string" || !task[field].trim()) throw new Error(`${label}.${field} must be a non-empty string`);
		if (ids.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
		ids.add(task.id);
		if (!VALID_STATUSES.has(task.status)) throw new Error(`${label}.status is invalid: ${task.status}`);
		if (typeof task.progress !== "string") throw new Error(`${label}.progress must be a string`);
		validateFiles(task, index);
		validateAgent(task, index);
	});
	phase.tasks.forEach((task, index) => validatePreRequest(task, index, ids));
	detectCycles(phase);
}

module.exports = {
	assertSafeSegment,
	projectRoot,
	readPhase,
	validatePhase,
	phaseNumber,
	listPhaseNames,
	withFileLock,
	PLAN_PATTERN,
	PHASE_PATTERN,
};