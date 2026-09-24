"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");

const { PLAN_PATTERN, assertSafeSegment, projectRoot, readPhase } = require("../_shared/phase");

const CONFIG_DIR = path.join(os.homedir(), ".config", "project-plan-manager");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

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

function initHandler(options) {
	const root = projectRoot(options);
	fs.mkdirSync(path.join(root, ".ppm"), { recursive: true });
	if (options.plan) {
		assertSafeSegment(options.plan, "plan name", PLAN_PATTERN);
		fs.mkdirSync(path.join(root, ".ppm", options.plan, "tasks"), { recursive: true });
	}
	registerProject(root);
	process.stdout.write(options.plan ? `Plan initialized: ${options.plan}\n` : `Project initialized: ${root}\n`);
}

function migrateHandler(options) {
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

function cleanRootsHandler(options) {
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

function phaseNumber(name) {
	const match = /^phase_(\d+)$/.exec(name);
	return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function planMetadata(content) {
	const read = (label) => {
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

function dashboardServeHandler(options) {
	const htmlPath = path.resolve(__dirname, "../../../templates/task.html");
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

function dashboardHealthHandler(options) {
	const port = options.port === undefined ? 4173 : Number(options.port);
	const url = `http://127.0.0.1:${port}/api/tasks`;
	const pageUrl = `http://127.0.0.1:${port}/task.html`;
	const request = http.get(url, { timeout: 2000 }, (response) => {
		if (response.statusCode !== 200) {
			process.stdout.write(`Dashboard unhealthy: ${url} returned HTTP ${response.statusCode}\n`);
			response.resume();
			process.exitCode = 2;
			return;
		}
		let body = "";
		response.setEncoding("utf8");
		response.on("data", (chunk) => { body += chunk; });
		response.on("end", () => {
			let data;
			try { data = JSON.parse(body); } catch {
				process.stdout.write(`Dashboard unhealthy: ${url} returned non-JSON payload\n`);
				process.exitCode = 2;
				return;
			}
			const projects = Array.isArray(data?.projects) ? data.projects : [];
			const plans = projects.reduce((sum, project) => sum + (Array.isArray(project?.plans) ? project.plans.length : 0), 0);
			process.stdout.write(`Dashboard running: ${pageUrl}\nProjects: ${projects.length}; Plans: ${plans}\n`);
		});
	});
	request.on("timeout", () => {
		request.destroy();
		process.stdout.write(`Dashboard not responding: ${url} (timeout)\nStart with: ppm dashboard_serve [--port ${port}]\n`);
		process.exitCode = 1;
	});
	request.on("error", (error) => {
		if (error.code === "ECONNREFUSED") {
			process.stdout.write(`Dashboard not running: ${pageUrl}\nStart with: ppm dashboard_serve [--port ${port}]\n`);
			process.exitCode = 1;
			return;
		}
		process.stdout.write(`Dashboard check failed: ${url} (${error.message})\n`);
		process.exitCode = 1;
	});
}

function validatePort(opts) {
	if (opts.port === undefined) return;
	if (!/^\d+$/.test(opts.port) || Number(opts.port) < 1 || Number(opts.port) > 65535)
		throw new Error("port must be between 1 and 65535");
}

module.exports = {
	initHandler,
	migrateHandler,
	cleanRootsHandler,
	dashboardServeHandler,
	dashboardHealthHandler,
	validatePort,
};