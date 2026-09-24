# Planning Flow

Use this flow for creating a structured project plan or breaking work into executable tasks. Read this file in full before acting.

## Resolve the project and plan

Resolve `<project-path>` explicitly when supplied; otherwise use the active working-directory project root. Ask when multiple roots are plausible. Use a lowercase kebab-case `<plan-name>` unless the project already follows another convention. Projects register in `~/.config/project-plan-manager/config.json`.

Before writing any plan file, initialize and register the target plan:

```bash
ppm init --plan <plan-name> [--project <project-path>]
```

The plan layout is:

```text
<project-path>/.ppm/<plan-name>/
|-- plan.md
`-- tasks/
    |-- phase_0.json
    |-- phase_1.json
    `-- phase_2.json
```

## Planning rules

- Inspect relevant source, configuration, and documentation before planning.
- Separate verified facts, assumptions, decisions, open questions, and future work.
- Do not invent requirements. Ask when missing information changes scope, behavior, acceptance criteria, or architecture.
- Make phases ordered, dependency-aware, independently verifiable, and traceable to deliverables.
- Link source requirements and related project documentation with relative paths.
- Include `Last updated: YYYY-MM-DD` in maintained Markdown files.
- Directly write newly created phase JSON during planning when needed; execution must use the CLI for task data.

## Mandatory plan.md format

Every `plan.md` must use this exact skeleton:

```markdown
# <Plan Name>

Created: <YYYY-MM-DD>
Last updated: <YYYY-MM-DD>

## 1. Objective

## 2. Source documents and requirements

## 3. Current-state findings

## 4. Constraints and invariants

## 5. Proposed approach

## 6. Dependencies

## 7. Risks and mitigations

## 8. Verification strategy

## 9. Definition of done
```

The headings, their order, and the `Created:` and `Last updated:` metadata labels are mandatory. `Created` remains the initial creation date. Change `Last updated` whenever `plan.md` or a phase plan definition is maintained. Do not add the previously used Ordered phases or Deliverables sections to the mandatory skeleton; phase delivery details belong in phase JSON or appropriate existing narrative. Every JSON task must trace to a phase deliverable.

## Task JSON contract

Each `tasks/phase_x.json` uses:

```json
{
  "phase": "phase_x",
  "title": "Phase title",
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Short action-oriented title",
      "detail": "Implementation detail, constraints, expected result, verification.",
      "status": "todo",
      "progress": "",
      "pre_request": ["TASK-002"]
    }
  ]
}
```

Invariants:

- `phase` matches the filename without `.json`.
- IDs remain unique and stable within a phase.
- Status is exactly `todo`, `in_progress`, `completed`, or `fail`.
- New tasks start as `todo`.
- `progress` is a concise, factual execution record, verification evidence, or failure context.
- Task detail lets another agent execute without rediscovering settled intent.
- `pre_request` is optional. When present it lists task IDs within the same phase that must reach `completed` before this task can start. Omit the field, or set it to `[]`, when a task is independent and parallel-eligible inside its phase.
- `pre_request` entries must reference existing task IDs in the same phase, must not include the task itself, must not duplicate, and must not form cycles.

## Phases, sequential execution, and parallel tasks

Phases are processed strictly in numeric order (`phase_0`, `phase_1`, ...). A later phase only begins after every task in the current phase is `completed`.

Within a single phase, tasks whose `pre_request` is absent or empty can run in parallel; tasks with `pre_request` entries must wait until each referenced task is `completed`. Use `ppm task_ready --plan <name> --phase <phase_x>` to list the tasks currently eligible to start (status `todo` with all `pre_request` dependencies `completed`). Use `ppm task_blocked` to inspect tasks still waiting on unmet dependencies. The plan model is therefore "sequential phases, parallelizable tasks inside a phase".

## Required planning deliverables

Produce `plan.md` and one phase JSON file per ordered phase. Include actionable tasks, dependencies, acceptance or verification criteria, risks and mitigations, unresolved questions, and a definition of done. Confirm all files are inside the intended project and referenced paths exist. Report changed files, current status, unresolved questions, and verification.

## Supporting commands

Run from the target project root, or add `--project <project-path>`:

```bash
ppm init [--project <project-path>]
ppm init --plan <plan-name> [--project <project-path>]
ppm migrate [--project <project-path>] [--dry-run]
ppm clean_roots [--dry-run]
```

Run `ppm migrate --dry-run` before `ppm migrate`. Run `ppm clean_roots --dry-run` before `ppm clean_roots`. `plan_init` remains a compatibility alias for `init --plan`.
