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
