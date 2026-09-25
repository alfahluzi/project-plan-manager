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

function depsSatisfied(task, statusById) {
	const deps = Array.isArray(task.pre_request) ? task.pre_request : [];
	for (const dep of deps) if (statusById.get(dep) !== "completed") return false;
	return true;
}

function readyTasks(phase) {
	const statusById = new Map(phase.tasks.map((task) => [task.id, task.status]));
	return phase.tasks
		.filter((task) => task.status === "todo" && depsSatisfied(task, statusById))
		.map(({ id, title, pre_request }) => ({
			id,
			title,
			pre_request: Array.isArray(pre_request) ? pre_request : [],
		}));
}

function blockedTasks(phase) {
	const statusById = new Map(phase.tasks.map((task) => [task.id, task.status]));
	return phase.tasks
		.filter((task) => task.status === "todo" && !depsSatisfied(task, statusById))
		.map(({ id, title, pre_request }) => {
			const waiting = (Array.isArray(pre_request) ? pre_request : [])
				.filter((dep) => statusById.get(dep) !== "completed");
			return { id, title, waiting };
		});
}

function writePhase(taskFile, phase) {
	const temporaryFile = `${taskFile}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporaryFile, `${JSON.stringify(phase, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		fs.renameSync(temporaryFile, taskFile);
	} finally { if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile); }
}

function printFields(fields) {
	process.stdout.write(`${fields.map(([label, value]) => `## ${label}\n${value}`).join("\n")}\n`);
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

function formatReadyEntry({ id, title, pre_request }) {
	const deps = pre_request.length ? `\nPre-request: ${pre_request.join(", ")}` : "";
	return `## ${id} - ${title}${deps}`;
}

function taskReadyHandler(options) {
	const { phase } = loadPhase(options);
	const ready = readyTasks(phase);
	if (!ready.length) {
		const blocked = blockedTasks(phase);
		const blockedNote = blocked.length
			? `\nBlocked tasks waiting on unmet pre_request: ${blocked.map(({ id }) => id).join(", ")}\n`
			: "";
		process.stdout.write(`No ready tasks.${blockedNote}`);
		return;
	}
	process.stdout.write(`Ready tasks (parallel-eligible within this phase): ${ready.length}\n\n${ready.map(formatReadyEntry).join("\n\n")}\n`);
}

function taskBlockedHandler(options) {
	const { phase } = loadPhase(options);
	const blocked = blockedTasks(phase);
	if (!blocked.length) {
		process.stdout.write("No blocked tasks.\n");
		return;
	}
	const lines = blocked.map(({ id, title, waiting }) => `## ${id} - ${title}\nWaiting on: ${waiting.join(", ")}`);
	process.stdout.write(`${lines.join("\n\n")}\n`);
}

function eligibility(task, phase) {
	if (task.status !== "todo") return null;
	const statusById = new Map(phase.tasks.map((candidate) => [candidate.id, candidate.status]));
	const deps = Array.isArray(task.pre_request) ? task.pre_request : [];
	if (deps.length === 0) return "parallel (no pre_request)";
	return depsSatisfied(task, statusById) ? "ready (pre_request satisfied)" : "blocked (pre_request unmet)";
}

function taskGetHandler(options) {
	const { phase } = loadPhase(options);
	const task = getTask(phase, options["task-id"]);
	const deps = Array.isArray(task.pre_request) ? task.pre_request : [];
	const parallel = eligibility(task, phase);
	printFields([
		["Title", task.title],
		["Status", task.status],
		["Pre-request", deps.length ? deps.join(", ") : "None"],
		["Eligibility", parallel || "N/A (not todo)"],
		["Detail", task.detail],
		["Progress", task.progress || "No progress recorded."],
	]);
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
	taskReadyHandler,
	taskBlockedHandler,
	taskGetHandler,
	taskWriteProgressHandler,
	setTaskStatus,
	validateProgressText,
	readyTasks,
	blockedTasks,
};