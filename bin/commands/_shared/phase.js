"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { PLAN_PATTERN, PHASE_PATTERN } = require("./patterns");

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
	if (Array.isArray(phase?.tasks)) {
		for (const task of phase.tasks) {
			if (task && typeof task === "object" && task.progress === undefined) task.progress = "";
			if (task && typeof task === "object" && task.status === "start") task.status = "todo";
			if (task && typeof task === "object" && "fail_desc" in task) delete task.fail_desc;
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
		if (!["todo", "in_progress", "completed", "fail"].includes(task.status)) throw new Error(`${label}.status is invalid: ${task.status}`);
		if (typeof task.progress !== "string") throw new Error(`${label}.progress must be a string`);
	});
	phase.tasks.forEach((task, index) => validatePreRequest(task, index, ids));
	detectCycles(phase);
}

module.exports = { assertSafeSegment, projectRoot, readPhase, validatePhase, PLAN_PATTERN, PHASE_PATTERN };