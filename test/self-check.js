#!/usr/bin/env node
"use strict";

// Zero-dependency self-check: runs the real CLI against a throwaway project. Usage: node test/self-check.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "../bin/ppm.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ppm-check-"));
const env = { ...process.env, HOME: tmp }; // keep ~/.config writes inside tmp
const project = path.join(tmp, "proj");
const tasksDir = path.join(project, ".ppm", "demo", "tasks");

function ppm(...args) {
	const result = spawnSync(process.execPath, [CLI, ...args, "--project", project], { env, encoding: "utf8" });
	return { code: result.status, out: result.stdout + result.stderr };
}

function ok(...args) {
	const result = ppm(...args);
	assert.equal(result.code, 0, `expected success: ppm ${args.join(" ")}\n${result.out}`);
	return result.out;
}

function bad(pattern, ...args) {
	const result = ppm(...args);
	assert.notEqual(result.code, 0, `expected failure: ppm ${args.join(" ")}\n${result.out}`);
	assert.match(result.out, pattern);
}

const task = (id, extra = {}) => ({ id, title: id, detail: "d", status: "todo", progress: "", ...extra });
const writePhase = (name, tasks) => fs.writeFileSync(path.join(tasksDir, `${name}.json`), JSON.stringify({ phase: name, title: name, tasks }));
const readTasks = (name) => JSON.parse(fs.readFileSync(path.join(tasksDir, `${name}.json`), "utf8")).tasks;
const p0 = ["--plan", "demo", "--phase", "phase_0"];
const p1 = ["--plan", "demo", "--phase", "phase_1"];

async function main() {
	fs.mkdirSync(project);
	ok("init", "--plan", "demo");
	fs.writeFileSync(path.join(project, ".ppm", "demo", "plan.md"), "# Demo\n");

	// plan_validate: cycle and unknown dependency are reported, valid plan passes.
	writePhase("phase_0", [task("A", { pre_request: ["B"] }), task("B", { pre_request: ["A"] })]);
	bad(/cycle detected/, "plan_validate", "--plan", "demo");
	writePhase("phase_0", [task("A", { pre_request: ["Z"] })]);
	bad(/unknown task id/, "plan_validate", "--plan", "demo");

	writePhase("phase_0", [task("A"), task("B"), task("C", { pre_request: ["A", "B"] })]);
	writePhase("phase_1", [task("D")]);
	assert.match(ok("plan_validate", "--plan", "demo"), /Plan valid: demo; phases: 2; tasks: 4/);

	// ready / blocked.
	const ready = ok("task_ready", ...p0);
	assert.match(ready, /Ready tasks .*: 2/);
	assert.doesNotMatch(ready, /## C/);
	assert.match(ok("task_blocked", ...p0), /## C - C\nWaiting on: A, B/);

	// Transition guards.
	bad(/invalid transition/, "task_completed", ...p0, "--task-id", "A");
	bad(/blocked by unmet pre_request: A, B/, "task_in_progress", ...p0, "--task-id", "C");
	bad(/earlier phase not completed: phase_0/, "task_in_progress", ...p1, "--task-id", "D");
	ok("task_in_progress", ...p0, "--task-id", "A");
	bad(/already in_progress/, "task_in_progress", ...p0, "--task-id", "A");
	ok("task_completed", ...p0, "--task-id", "A");
	ok("task_completed", ...p0, "--task-id", "B", "--force");

	// Progress appends with timestamps; --replace overwrites; values may start with "--".
	ok("task_write_progress", ...p0, "--task-id", "C", "--progress-text", "first");
	ok("task_write_progress", ...p0, "--task-id", "C", "--progress-text", "--second");
	const progress = readTasks("phase_0").find((t) => t.id === "C").progress.split("\n");
	assert.equal(progress.length, 2);
	assert.match(progress[0], /^\[\d{4}-\d\d-\d\dT[\d:]+Z\] first$/);
	assert.match(progress[1], /\] --second$/);
	ok("task_write_progress", ...p0, "--task-id", "C", "--progress-text", "only", "--replace");
	assert.equal(readTasks("phase_0").find((t) => t.id === "C").progress, "only");

	// plan_status reports current phase.
	assert.match(ok("plan_status", "--plan", "demo"), /Current phase: phase_0/);

	// Legacy fail_desc is folded into progress, not dropped.
	writePhase("phase_1", [task("D", { status: "fail", fail_desc: "boom" })]);
	ok("task_write_progress", ...p1, "--task-id", "D", "--progress-text", "retry");
	assert.match(readTasks("phase_1")[0].progress, /\[legacy fail_desc\] boom\n\[.*\] retry/);
	assert.equal("fail_desc" in readTasks("phase_1")[0], false);

	// Pure analysis: glob overlap, waves, critical path.
	const { patternsOverlap, waves, criticalPath } = require("../bin/commands/_shared/analysis");
	assert.equal(patternsOverlap("src/a.ts", "src/**"), true);
	assert.equal(patternsOverlap("src/api/", "src/api/x.ts"), true);
	assert.equal(patternsOverlap("src/*.ts", "src/x/y.ts"), false);
	assert.equal(patternsOverlap("src/a/**", "src/b/**"), false);
	assert.equal(patternsOverlap("src/a.ts", "src/b.ts"), false);
	const diamond = { tasks: [task("A"), task("B", { pre_request: ["A"] }), task("C", { pre_request: ["A"] }), task("D", { pre_request: ["B", "C"] })] };
	assert.deepEqual(waves(diamond).map((wave) => wave.map((t) => t.id)), [["A"], ["B", "C"], ["D"]]);
	assert.equal(criticalPath(diamond).length, 3);

	// files/agent schema.
	writePhase("phase_1", [task("D", { files: ["/abs"] })]);
	bad(/must be repo-relative/, "plan_validate", "--plan", "demo");
	writePhase("phase_1", [task("D", { agent: "wizard" })]);
	bad(/agent must be one of/, "plan_validate", "--plan", "demo");

	// Concurrent file overlap is an error; ordering via pre_request resolves it.
	const packet = "Goal: g\nFiles: f\nSteps: s\nVerify: v\nDone when: d";
	const t = (id, extra) => task(id, { detail: packet, agent: "implement", ...extra });
	writePhase("phase_1", [t("E", { files: ["src/shared.ts"] }), t("F", { files: ["src/**"] })]);
	bad(/E and F can run concurrently but share files/, "plan_validate", "--plan", "demo");
	writePhase("phase_1", [t("E", { files: ["src/shared.ts"] }), t("F", { files: ["src/**"], pre_request: ["E"] })]);
	assert.doesNotMatch(ok("plan_validate", "--plan", "demo"), /share files/);

	// Warnings: serial phase; --strict fails on warnings; well-formed fan-out has none for that phase.
	assert.match(ok("plan_validate", "--plan", "demo"), /phase_1: fully serial/);
	bad(/Plan invalid/, "plan_validate", "--plan", "demo", "--strict");
	writePhase("phase_1", [
		t("E", { files: ["src/a.ts"] }),
		t("F", { files: ["src/b.ts"] }),
		t("G", { files: ["src/index.ts"], agent: "verify", pre_request: ["E", "F"] }),
	]);
	assert.doesNotMatch(ok("plan_validate", "--plan", "demo"), /phase_1:/);
	const wavesOut = ok("plan_waves", "--plan", "demo");
	assert.match(wavesOut, /## phase_1[^]*Wave 1 \(2\): E \[implement\], F \[implement\]\nWave 2 \(1\): G \[verify\]/);
	assert.match(wavesOut, /Critical path \(2\): (E|F) -> G/);
	assert.match(ok("task_get", ...p1, "--task-id", "E"), /## Agent\nimplement\n## Files\nsrc\/a.ts/);

	// Parallel writers on one phase file: no lost updates.
	const ids = Array.from({ length: 12 }, (_, i) => `P${i}`);
	writePhase("phase_1", ids.map((id) => task(id)));
	await Promise.all(ids.map((id) => new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [CLI, "task_write_progress", ...p1, "--task-id", id, "--progress-text", `done ${id}`, "--project", project], { env });
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer ${id} exited ${code}`))));
	})));
	for (const t of readTasks("phase_1")) assert.match(t.progress, new RegExp(`done ${t.id}$`), `lost update for ${t.id}`);
	assert.equal(fs.readdirSync(tasksDir).some((name) => name.endsWith(".lock")), false, "stale lock left behind");

	process.stdout.write("self-check passed\n");
}

main()
	.catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; })
	.finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
