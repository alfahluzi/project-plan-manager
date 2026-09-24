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
}

module.exports = { assertSafeSegment, projectRoot, readPhase, validatePhase, PLAN_PATTERN, PHASE_PATTERN };