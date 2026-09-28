"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	PLAN_PATTERN,
	PHASE_PATTERN,
	assertSafeSegment,
	projectRoot,
	readPhase,
	validatePhase,
	listPhaseNames,
	withFileLock,
} = require("../_shared/phase");
const { waves, criticalPath, lintPhase } = require("../_shared/analysis");

function resolvePlanRoot(options) {
	assertSafeSegment(options.plan, "plan name", PLAN_PATTERN);
	const root = projectRoot(options);
	const planRoot = path.resolve(root, ".ppm", options.plan);
	if (!planRoot.startsWith(`${path.resolve(root, ".ppm")}${path.sep}`)) throw new Error("resolved plan is outside the project .ppm directory");
	return planRoot;
}

function resolveTaskFile(options) {
	assertSafeSegment(options.phase, "phase name", PHASE_PATTERN);
	return path.join(resolvePlanRoot(options), "tasks", `${options.phase}.json`);
}

function getTask(phase, taskId) {
	const task = phase.tasks.find((candidate) => candidate.id === taskId);
	if (!task) throw new Error(`task not found: ${taskId}`);
	return task;
}

function depsOf(task) {
	return Array.isArray(task.pre_request) ? task.pre_request : [];
}

function statusMap(phase) {
	return new Map(phase.tasks.map((task) => [task.id, task.status]));
}

function unmetDeps(task, statusById) {
	return depsOf(task).filter((dep) => statusById.get(dep) !== "completed");
}

function readyTasks(phase) {
	const statusById = statusMap(phase);
	return phase.tasks
		.filter((task) => task.status === "todo" && !unmetDeps(task, statusById).length)
		.map(({ id, title, pre_request }) => ({ id, title, pre_request: depsOf({ pre_request }) }));
}

function blockedTasks(phase) {
	const statusById = statusMap(phase);
	return phase.tasks
		.filter((task) => task.status === "todo" && unmetDeps(task, statusById).length)
		.map((task) => ({ id: task.id, title: task.title, waiting: unmetDeps(task, statusById) }));
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
	return { taskFile, phase: readPhase(taskFile, options.phase) };
}

// Locked read-modify-write of one phase file.
function mutatePhase(options, mutate) {
	const taskFile = resolveTaskFile(options);
	if (!fs.existsSync(taskFile)) throw new Error(`task file not found: ${taskFile}`);
	return withFileLock(taskFile, () => {
		const phase = readPhase(taskFile, options.phase);
		const result = mutate(phase);
		validatePhase(phase, options.phase);
		writePhase(taskFile, phase);
		return result;
	});
}

// Allowed status transitions. --force bypasses (manual repair only).
const TRANSITIONS = {
	in_progress: ["todo", "fail"],
	completed: ["in_progress"],
	fail: ["todo", "in_progress"],
	todo: ["in_progress", "completed", "fail"],
};

function assertTransition(phase, task, next, planRoot, phaseName) {
	if (task.status === next) throw new Error(`task ${task.id} is already ${next}`);
	if (!TRANSITIONS[next].includes(task.status))
		throw new Error(`invalid transition for ${task.id}: ${task.status} -> ${next} (allowed from: ${TRANSITIONS[next].join(", ")}; use --force to override)`);
	if (next !== "in_progress") return;
	const waiting = unmetDeps(task, statusMap(phase));
	if (waiting.length) throw new Error(`task ${task.id} is blocked by unmet pre_request: ${waiting.join(", ")} (use --force to override)`);
	const unfinished = earlierUnfinishedPhases(planRoot, phaseName);
	if (unfinished.length) throw new Error(`earlier phase not completed: ${unfinished.join(", ")} (use --force to override)`);
}

function earlierUnfinishedPhases(planRoot, phaseName) {
	const names = listPhaseNames(planRoot);
	const index = names.indexOf(phaseName);
	return names.slice(0, Math.max(index, 0)).filter((name) => {
		const phase = readPhase(path.join(planRoot, "tasks", `${name}.json`), name);
		return phase.tasks.some((task) => task.status !== "completed");
	});
}

function setTaskStatus(options, status) {
	const planRoot = resolvePlanRoot(options);
	mutatePhase(options, (phase) => {
		const task = getTask(phase, options["task-id"]);
		if (!options.force) assertTransition(phase, task, status, planRoot, options.phase);
		task.status = status;
	});
	process.stdout.write("Task status updated\n");
}

function timestamp() {
	return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function taskWriteProgressHandler(options) {
	const text = options["progress-text"].trim();
	mutatePhase(options, (phase) => {
		const task = getTask(phase, options["task-id"]);
		const entry = `[${timestamp()}] ${text}`;
		task.progress = options.replace ? text : [task.progress.trim(), entry].filter(Boolean).join("\n");
	});
	process.stdout.write("progress updated\n");
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
	if (!depsOf(task).length) return "parallel (no pre_request)";
	return unmetDeps(task, statusMap(phase)).length ? "blocked (pre_request unmet)" : "ready (pre_request satisfied)";
}

function taskGetHandler(options) {
	const { phase } = loadPhase(options);
	const task = getTask(phase, options["task-id"]);
	const deps = depsOf(task);
	printFields([
		["Title", task.title],
		["Status", task.status],
		["Pre-request", deps.length ? deps.join(", ") : "None"],
		["Eligibility", eligibility(task, phase) || "N/A (not todo)"],
		["Agent", task.agent || "Unspecified"],
		["Files", Array.isArray(task.files) && task.files.length ? task.files.join("\n") : "Unspecified"],
		["Detail", task.detail],
		["Progress", task.progress || "No progress recorded."],
	]);
}

function planPhases(options) {
	const planRoot = resolvePlanRoot(options);
	if (!fs.existsSync(planRoot)) throw new Error(`plan not found: ${planRoot}`);
	return { planRoot, names: listPhaseNames(planRoot) };
}

// Errors: schema defects and concurrent file-ownership conflicts (always fail).
// Warnings: efficiency/clarity smells (fail only with --strict).
function planValidateHandler(options) {
	const { planRoot, names } = planPhases(options);
	const errors = [];
	const warnings = [];
	if (!fs.existsSync(path.join(planRoot, "plan.md"))) errors.push("plan.md: missing");
	if (!names.length) errors.push("tasks/: no phase_*.json files");
	let taskCount = 0;
	for (const name of names) {
		let phase;
		try { phase = readPhase(path.join(planRoot, "tasks", `${name}.json`), name); } catch (error) {
			errors.push(`${name}: ${error.message}`);
			continue;
		}
		taskCount += phase.tasks.length;
		const lint = lintPhase(phase);
		errors.push(...lint.errors.map((message) => `${name}: ${message}`));
		warnings.push(...lint.warnings.map((message) => `${name}: ${message}`));
	}
	const list = (items) => items.map((item) => `- ${item}`).join("\n");
	const warningBlock = warnings.length ? `Warnings (${warnings.length}):\n${list(warnings)}\n` : "";
	if (errors.length || (options.strict && warnings.length)) {
		process.stdout.write(`Plan invalid: ${options.plan}\n${errors.length ? `Errors (${errors.length}):\n${list(errors)}\n` : ""}${warningBlock}`);
		process.exitCode = 1;
		return;
	}
	process.stdout.write(`Plan valid: ${options.plan}; phases: ${names.length}; tasks: ${taskCount}; warnings: ${warnings.length}\n${warningBlock}`);
}

function planWavesHandler(options) {
	const { planRoot, names } = planPhases(options);
	if (!names.length) {
		process.stdout.write("No phases.\n");
		return;
	}
	let totalWaves = 0, totalTasks = 0, peak = 0;
	const blocks = names.map((name) => {
		const phase = readPhase(path.join(planRoot, "tasks", `${name}.json`), name);
		const phaseWaves = waves(phase);
		totalWaves += phaseWaves.length;
		totalTasks += phase.tasks.length;
		peak = Math.max(peak, ...phaseWaves.map((wave) => wave.length), 0);
		const lines = phaseWaves.map((wave, index) => `Wave ${index + 1} (${wave.length}): ${wave.map((task) => `${task.id}${task.agent ? ` [${task.agent}]` : ""}${task.status === "todo" ? "" : ` (${task.status})`}`).join(", ")}`);
		const chain = criticalPath(phase);
		return `## ${name} - ${phase.title || name}\n${lines.join("\n") || "No tasks."}\nCritical path (${chain.length}): ${chain.join(" -> ") || "-"}`;
	});
	const speedup = totalWaves ? (totalTasks / totalWaves).toFixed(2) : "0";
	process.stdout.write(`${blocks.join("\n\n")}\n\nSummary: ${names.length} phases (sync barriers), ${totalWaves} sequential waves, ${totalTasks} tasks, peak width ${peak}, avg parallelism ${speedup}\n`);
}

function planStatusHandler(options) {
	const { planRoot, names } = planPhases(options);
	if (!names.length) {
		process.stdout.write("No phases.\n");
		return;
	}
	let current = null;
	const lines = names.map((name) => {
		const phase = readPhase(path.join(planRoot, "tasks", `${name}.json`), name);
		const counts = { todo: 0, in_progress: 0, completed: 0, fail: 0 };
		for (const task of phase.tasks) counts[task.status] += 1;
		const done = counts.completed === phase.tasks.length;
		if (!done && current === null) current = name;
		const summary = Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(", ");
		return `## ${name} - ${phase.title || name}\n${done ? "Completed" : "Open"}: ${summary}`;
	});
	process.stdout.write(`${lines.join("\n\n")}\n\nCurrent phase: ${current || "none (plan complete)"}\n`);
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
	planValidateHandler,
	planStatusHandler,
	planWavesHandler,
	validateProgressText,
	readyTasks,
	blockedTasks,
	assertTransition,
};
