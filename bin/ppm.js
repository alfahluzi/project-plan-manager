#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");

const OPERATIONS = new Set([
	"init",
	"plan_init",
	"migrate",
	"clean_roots",
	"dashboard_serve",
	"task_list",
	"task_get_progress",
	"task_get_detail",
	"task_in_progress",
	"task_completed",
	"task_fail",
	"task_reset",
	"task_write_progress",
]);
const VALID_STATUSES = new Set(["todo", "in_progress", "completed", "fail"]);
const PLAN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONFIG_DIR = path.join(os.homedir(), ".config", "project-plan-manager");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function usage() {
	return [
		"Usage:",
		"  ppm init [--plan <name>] [--project <path>]",
		"  ppm migrate [--project <path>] [--dry-run]",
		"  ppm clean_roots [--dry-run]",
		"  ppm dashboard_serve [--project <path>] [--port <port>]",
		"  ppm task_list --plan <name> --phase <phase_x> [--project <path>]",
		"  ppm task_get_progress --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		"  ppm task_get_detail --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		"  ppm task_in_progress --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		"  ppm task_completed --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		"  ppm task_fail --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		"  ppm task_reset --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		"  ppm task_write_progress --plan <name> --phase <phase_x> --task-id <id> --progress-text <text> [--project <path>]",
		"",
		"Compatibility: plan_init remains an alias for init --plan.",
	].join("\n");
}

function fail(message) {
	process.stderr.write(`Error: ${message}\n`);
	process.exitCode = 1;
}

function parseArgs(argv) {
	const operation = argv[0];
	if (!OPERATIONS.has(operation)) throw new Error(`unknown or missing operation\n${usage()}`);
	const options = {};
	for (let index = 1; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
		const key = token.slice(2);
		if (!["project", "plan", "phase", "task-id", "progress-text", "port", "dry-run"].includes(key)) {
			throw new Error(`unknown option: ${token}`);
		}
		if (options[key] !== undefined) throw new Error(`duplicate option: ${token}`);
		if (key === "dry-run") {
			options[key] = true;
			continue;
		}
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${token}`);
		options[key] = value;
		index += 1;
	}
	if (operation === "plan_init" && !options.plan) throw new Error(`missing --plan\n${usage()}`);
	if (!["init", "plan_init", "migrate", "clean_roots", "dashboard_serve"].includes(operation)) {
		for (const required of ["plan", "phase"]) {
			if (!options[required]) throw new Error(`missing --${required}\n${usage()}`);
		}
	}
	if (!["task_list", "init", "plan_init", "migrate", "clean_roots", "dashboard_serve"].includes(operation) && !options["task-id"]) {
		throw new Error(`missing --task-id\n${usage()}`);
	}
	if (operation === "task_write_progress" && !options["progress-text"]?.trim()) {
		throw new Error("task_write_progress requires a non-empty --progress-text");
	}
	if (options.port !== undefined && operation !== "dashboard_serve") throw new Error("--port is only supported by dashboard_serve");
	if (options.port !== undefined && (!/^\d+$/.test(options.port) || Number(options.port) < 1 || Number(options.port) > 65535)) {
		throw new Error("port must be between 1 and 65535");
	}
	if (options["dry-run"] && !["migrate", "clean_roots"].includes(operation)) {
		throw new Error("--dry-run is only supported by migrate and clean_roots");
	}
	if (operation === "clean_roots" && options.project) throw new Error("--project is not supported by clean_roots");
	return { operation, options };
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

function templatePath() {
	return path.resolve(__dirname, "../templates/task.html");
}

function readConfig() {
	if (!fs.existsSync(CONFIG_FILE)) return { projects: [] };
	let config;
	try {
		config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
	} catch (error) {
		throw new Error(`invalid config ${CONFIG_FILE}: ${error.message}`);
	}
	if (!config || !Array.isArray(config.projects)) throw new Error(`config projects must be an array: ${CONFIG_FILE}`);
	return config;
}

function writeConfig(config) {
	fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
	const temporary = `${CONFIG_FILE}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
		fs.renameSync(temporary, CONFIG_FILE);
	} finally {
		if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
	}
}

function registerProject(root) {
	const config = readConfig();
	const projects = config.projects.filter((entry) => entry && entry.path && path.resolve(entry.path) !== root);
	projects.push({ name: path.basename(root), path: root });
	projects.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
	writeConfig({ ...config, projects });
}

function initialize(options) {
	const root = projectRoot(options);
	fs.mkdirSync(path.join(root, ".ppm"), { recursive: true });
	if (options.plan) {
		assertSafeSegment(options.plan, "plan name", PLAN_PATTERN);
		fs.mkdirSync(path.join(root, ".ppm", options.plan, "tasks"), { recursive: true });
	}
	registerProject(root);
	process.stdout.write(options.plan ? `Plan initialized: ${options.plan}\n` : `Project initialized: ${root}\n`);
}

function migrateLegacy(options) {
	const root = projectRoot(options);
	const source = path.join(root, "docs", "plans");
	const destination = path.join(root, ".ppm");
	if (!fs.existsSync(source)) throw new Error(`legacy plans directory not found: ${source}`);
	const plans = fs.readdirSync(source, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && PLAN_PATTERN.test(entry.name))
		.map((entry) => entry.name)
		.sort();
	if (!plans.length) throw new Error(`no legacy plans found in: ${source}`);
	const conflicts = plans.filter((name) => fs.existsSync(path.join(destination, name)));
	if (conflicts.length) throw new Error(`migration stopped; destination already exists: ${conflicts.join(", ")}`);
	for (const name of plans) process.stdout.write(`${options["dry-run"] ? "Would migrate" : "Migrating"}: docs/plans/${name} -> .ppm/${name}\n`);
	if (options["dry-run"]) return;
	fs.mkdirSync(destination, { recursive: true });
	for (const name of plans) fs.renameSync(path.join(source, name), path.join(destination, name));
	const legacyDashboard = path.join(source, "task.html");
	if (fs.existsSync(legacyDashboard)) fs.unlinkSync(legacyDashboard);
	if (fs.readdirSync(source).length === 0) fs.rmdirSync(source);
	const docs = path.join(root, "docs");
	if (fs.existsSync(docs) && fs.readdirSync(docs).length === 0) fs.rmdirSync(docs);
	registerProject(root);
	process.stdout.write(`Migration completed: ${plans.length} plan(s)\n`);
}

function cleanRoots(options) {
	const config = readConfig();
	const kept = [];
	const removed = [];
	const seen = new Set();
	for (const entry of config.projects) {
		if (!entry || typeof entry.path !== "string") {
			removed.push(String(entry?.path || "<invalid>"));
			continue;
		}
		let resolved;
		try {
			resolved = fs.realpathSync(entry.path);
			if (!fs.statSync(resolved).isDirectory() || !fs.statSync(path.join(resolved, ".ppm")).isDirectory()) throw new Error("invalid");
		} catch {
			removed.push(entry.path);
			continue;
		}
		if (seen.has(resolved)) {
			removed.push(entry.path);
			continue;
		}
		seen.add(resolved);
		kept.push({ name: path.basename(resolved), path: resolved });
	}
	for (const item of removed) process.stdout.write(`${options["dry-run"] ? "Would remove" : "Removed"}: ${item}\n`);
	if (!options["dry-run"]) writeConfig({ ...config, projects: kept });
	process.stdout.write(`${options["dry-run"] ? "Invalid" : "Cleaned"}: ${removed.length}; active: ${kept.length}\n`);
}

function resolveTaskFile(options) {
	assertSafeSegment(options.plan, "plan name", PLAN_PATTERN);
	assertSafeSegment(options.phase, "phase name", /^phase_[A-Za-z0-9][A-Za-z0-9_-]*$/);
	const root = projectRoot(options);
	const taskFile = path.resolve(root, ".ppm", options.plan, "tasks", `${options.phase}.json`);
	const allowedRoot = `${path.resolve(root, ".ppm")}${path.sep}`;
	if (!taskFile.startsWith(allowedRoot)) throw new Error("resolved task file is outside the project .ppm directory");
	return taskFile;
}

function phaseNumber(name) {
	const match = /^phase_(\d+)$/.exec(name);
	return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function planMetadata(content) {
	const read = label => {
		const match = new RegExp(`^\\s*${label}\\s*:\\s*(.*?)\\s*$`, "im").exec(content);
		return match && match[1] ? match[1].trim() : null;
	};
	return { createdAt: read("Created"), lastUpdated: read("Last updated") };
}

function readProjectData(project) {
	const plansRoot = path.join(project.path, ".ppm");
	const plans = fs.readdirSync(plansRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && PLAN_PATTERN.test(entry.name))
		.map((entry) => {
			const planRoot = path.join(plansRoot, entry.name);
			const taskRoot = path.join(planRoot, "tasks");
			const planFile = path.join(planRoot, "plan.md");
			let content = "";
			try { content = fs.readFileSync(planFile, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
			let taskFiles = [];
			try { taskFiles = fs.readdirSync(taskRoot, { withFileTypes: true }); } catch (error) { if (error.code !== "ENOENT") throw error; }
			const phases = taskFiles
				.filter((file) => file.isFile() && /^phase_.*\.json$/.test(file.name))
				.sort((a, b) => phaseNumber(path.basename(a.name, ".json")) - phaseNumber(path.basename(b.name, ".json")) || a.name.localeCompare(b.name))
				.map((file) => {
					const name = path.basename(file.name, ".json");
					const filePath = path.join(taskRoot, file.name);
					const phase = readPhase(filePath, name);
					return { name, title: phase.title || name, filePath, tasks: phase.tasks };
				});
			return { name: entry.name, content, ...planMetadata(content), phases };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	return { id: project.path, name: project.name, path: project.path, plans };
}

function dashboardProjects(options) {
	if (options.project) {
		const root = projectRoot(options);
		return [{ name: path.basename(root), path: root }];
	}
	return readConfig().projects.filter((entry) => entry && typeof entry.path === "string" && fs.existsSync(path.join(entry.path, ".ppm")));
}

function readDashboardData(options) {
	return { generatedAt: new Date().toISOString(), projects: dashboardProjects(options).map(readProjectData) };
}

function dashboardResponse(response, status, body, contentType) {
	response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
	response.end(body);
}

function serveDashboard(options) {
	const htmlPath = templatePath();
	const port = options.port === undefined ? 4173 : Number(options.port);
	const server = http.createServer((request, response) => {
		if (request.method !== "GET") return dashboardResponse(response, 405, JSON.stringify({ error: "Method not allowed" }), "application/json; charset=utf-8");
		const route = new URL(request.url, "http://127.0.0.1").pathname;
		try {
			if (route === "/api/tasks") return dashboardResponse(response, 200, JSON.stringify(readDashboardData(options)), "application/json; charset=utf-8");
			if (route === "/" || route === "/task.html") return dashboardResponse(response, 200, fs.readFileSync(htmlPath), "text/html; charset=utf-8");
			return dashboardResponse(response, 404, JSON.stringify({ error: "Not found" }), "application/json; charset=utf-8");
		} catch (error) {
			return dashboardResponse(response, 500, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
		}
	});
	server.listen(port, "127.0.0.1", () => process.stdout.write(`Dashboard available at http://127.0.0.1:${port}/task.html\n`));
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
		if (!VALID_STATUSES.has(task.status)) throw new Error(`${label}.status is invalid: ${task.status}`);
		if (typeof task.progress !== "string") throw new Error(`${label}.progress must be a string`);
	});
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

function run(argv) {
	const { operation, options } = parseArgs(argv);
	if (operation === "init" || operation === "plan_init") return initialize(options);
	if (operation === "migrate") return migrateLegacy(options);
	if (operation === "clean_roots") return cleanRoots(options);
	if (operation === "dashboard_serve") return serveDashboard(options);
	const taskFile = resolveTaskFile(options);
	const phase = readPhase(taskFile, options.phase);
	if (operation === "task_list") {
		const output = phase.tasks.map(({ id, title, status, progress }) => `## ${id} - ${title}\nStatus: ${status}${status === "todo" && progress.trim() ? ". Has progress" : ""}`).join("\n\n");
		process.stdout.write(output ? `${output}\n` : "No tasks.\n");
		return;
	}
	const task = getTask(phase, options["task-id"]);
	if (operation === "task_get_progress") return printFields([["Title", task.title], ["Status", task.status], ["Progress", task.progress || "No progress recorded."]]);
	if (operation === "task_get_detail") return printFields([["Title", task.title], ["Status", task.status], ["Detail", task.detail]]);
	if (operation === "task_write_progress") {
		task.progress = options["progress-text"].trim();
		validatePhase(phase, options.phase);
		writePhase(taskFile, phase);
		process.stdout.write("progress updated\n");
		return;
	}
	task.status = { task_in_progress: "in_progress", task_completed: "completed", task_fail: "fail", task_reset: "todo" }[operation];
	validatePhase(phase, options.phase);
	writePhase(taskFile, phase);
	process.stdout.write("Task status updated\n");
}

try { run(process.argv.slice(2)); } catch (error) { fail(error.message); }
