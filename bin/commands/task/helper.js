"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { PLAN_PATTERN, PHASE_PATTERN, assertSafeSegment, projectRoot, readPhase, validatePhase } = require("../_shared/phase");

function resolveTaskFile(options) {
	assertSafeSegment(options.plan, "plan name", PLAN_PATTERN);
	assertSafeSegment(options.phase, "phase name", PHASE_PATTERN);
	const root = projectRoot(options);
	const taskFile = path.resolve(root, ".ppm", options.plan, "tasks", `${options.phase}.json`);
	const allowedRoot = `${path.resolve(root, ".ppm")}${path.sep}`;
	if (!taskFile.startsWith(allowedRoot)) throw new Error("resolved task file is outside the project .ppm directory");
	return taskFile;
}

function getTask(phase, taskId) {
	const task = phase.tasks.find((candidate) => candidate.id === taskId);
	if (!task) throw new Error(`task not found: ${taskId}`);
	return task;
}

function writePhase(taskFile, phase) {
	const temporaryFile = `${taskFile}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporaryFile, `${JSON.stringify(phase, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		fs.renameSync(temporaryFile, taskFile);
	} finally { if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile); }
}

function printFields(fields) {
	process.stdout.write(`${fields.map(([label, value]) => `## ${label}\n${value}`).join("\n\n")}\n`);
}

function loadPhase(options) {
	const taskFile = resolveTaskFile(options);
	const phase = readPhase(taskFile, options.phase);
	return { taskFile, phase };
}

function taskListHandler(options) {
	const { phase } = loadPhase(options);
	const output = phase.tasks.map(({ id, title, status, progress }) => `## ${id} - ${title}\nStatus: ${status}${status === "todo" && progress.trim() ? ". Has progress" : ""}`).join("\n\n");
	process.stdout.write(output ? `${output}\n` : "No tasks.\n");
}

function taskGetProgressHandler(options) {
	const { phase } = loadPhase(options);
	const task = getTask(phase, options["task-id"]);
	printFields([["Title", task.title], ["Status", task.status], ["Progress", task.progress || "No progress recorded."]]);
}

function taskGetDetailHandler(options) {
	const { phase } = loadPhase(options);
	const task = getTask(phase, options["task-id"]);
	printFields([["Title", task.title], ["Status", task.status], ["Detail", task.detail]]);
}

function taskWriteProgressHandler(options) {
	const { taskFile, phase } = loadPhase(options);
	const task = getTask(phase, options["task-id"]);
	task.progress = options["progress-text"].trim();
	validatePhase(phase, options.phase);
	writePhase(taskFile, phase);
	process.stdout.write("progress updated\n");
}

function setTaskStatus(options, status) {
	const { taskFile, phase } = loadPhase(options);
	const task = getTask(phase, options["task-id"]);
	task.status = status;
	validatePhase(phase, options.phase);
	writePhase(taskFile, phase);
	process.stdout.write("Task status updated\n");
}

function validateProgressText(opts) {
	if (!opts["progress-text"]?.trim())
		throw new Error("task_write_progress requires a non-empty --progress-text");
}

module.exports = {
	taskListHandler,
	taskGetProgressHandler,
	taskGetDetailHandler,
	taskWriteProgressHandler,
	setTaskStatus,
	validateProgressText,
};