---
name: project-plan-manager
description: Create, execute, and track structured project plans with phased JSON tasks, progress updates, and verification. Use for project planning, implementation plans, task breakdowns, plan execution, progress tracking, and resuming interrupted work.
compatibility: Requires Node.js >=18 and an Agent Skills-compatible client that can execute local CLI commands.
metadata:
  cli: ppm
  task-format: json
---

# Project Plan Manager

Read the routed flow file in full before acting. Its instructions are mandatory; do not substitute memory or summaries.

## Mandatory routing

- Planning, plan creation, or task breakdown: read and follow [prompts/planning-flow.md](prompts/planning-flow.md).
- Execution, continuation, or resume: read and follow [prompts/execution-flow.md](prompts/execution-flow.md).
- Auditing, reviewing, or validating a plan before execution: read and follow [prompts/audition-flow.md](prompts/audition-flow.md).
- Installation, PATH setup, enabling automatic use, or `AGENTS.md` integration: read and follow [prompts/installation-flow.md](prompts/installation-flow.md).
- If creating then implementing, load `prompts/planning-flow.md` before `prompts/execution-flow.md`. Load `prompts/audition-flow.md` only when explicitly auditing.

## Dashboard health check

Before sharing or recommending any dashboard URL, run `ppm check_dashboard [--port <port>]` (default port `4173`). The command probes `http://127.0.0.1:<port>/api/tasks` with a 2-second timeout:

- `Dashboard running: <page-url>` — share that URL with the user; do not invent a different port or host.
- `Dashboard not running: <page-url>` — start it yourself with `ppm dashboard_serve [--project <path>] [--port <port>]` (it is a long-lived background process; do not block the agent on it), then re-run `ppm check_dashboard` to confirm and share the verified URL.
- `Dashboard unhealthy` (non-200, timeout, parse error) — report the exact diagnostic; do not pretend the dashboard is usable.

Never quote a `127.0.0.1:<port>/task.html` URL unless `ppm check_dashboard` just confirmed that port. If the user supplies a port, use `--port <port>`; if they supply a project, pass `--project <path>` when starting the server.
