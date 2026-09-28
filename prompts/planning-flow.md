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

- Inspect relevant source, configuration, and documentation before planning. Use evidence, not guesses: when a code-intelligence tool (code graph, LSP, references search) is available, use it to map which files each change touches, who calls/imports them, and which changes truly depend on others. That evidence drives file ownership and `pre_request`.
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
      "agent": "implement",
      "files": ["src/api/users.ts", "src/api/users/**"],
      "detail": "Goal: ...\nFiles: ...\nContract: ...\nSteps: ...\nVerify: ...\nDone when: ...",
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
- Status is exactly `todo`, `in_progress`, `completed`, or `fail`. New tasks start as `todo`.
- `progress` is a concise, factual execution record, verification evidence, or failure context.
- `pre_request` is optional. When present it lists task IDs within the same phase that must reach `completed` before this task can start. Omit it, or use `[]`, for independent parallel-eligible tasks. Entries must reference existing task IDs in the same phase, must not include the task itself, must not duplicate, and must not form cycles.
- `files` is the task's write ownership: repo-relative paths, directories (trailing `/`), or globs (`*`, `**`, `?`). No absolute paths, no `..`. A task may read anything but must only modify files it owns.
- `agent` is a client-agnostic role hint: `explore` (read-only investigation), `implement` (code change), `review` (read-only diff/plan review), or `verify` (run checks, report evidence). The executor maps it to whatever sub agents the client provides.

## Designing for parallel sub-agent execution

The plan is a schedule for an orchestrator dispatching tasks to fresh-context sub agents. Optimize for the fewest sequential waves with zero write conflicts and zero rediscovery.

### 1. Phases are sync barriers, not topics

A phase boundary forces every lane to stop until the whole phase is `completed`. Create a new phase only when the next work needs the verified, integrated result of the current phase (for example a shared contract that must exist and compile before consumers build on it). Express every other ordering with `pre_request` inside one phase. Prefer 2 to 4 phases; a plan with many single-topic phases is serial execution in disguise.

Default shape:

- `phase_0` Foundation: contracts first. Shared types, interfaces, schemas, signatures, stubs, migrations, config keys. Small, often serial.
- `phase_1..n` Fan-out: many independent tasks, each implementing one slice against the fixed contract.
- Closing task per phase: one `verify` or `review` task whose `pre_request` lists every other task of the phase. It integrates, runs the phase verification, and owns shared registration files.

### 2. File ownership (accuracy)

- Every task that can run concurrently with another must declare `files`.
- Tasks that may run at the same time must not own the same file. `plan_validate` fails on overlaps; fix by adding `pre_request` or moving the shared file to one task.
- Hotspot files touched by many slices (`package.json`, lockfiles, barrel `index` files, route/DI registries, migration numbering, shared config) belong to the foundation task or the closing integration task, never to several fan-out tasks.

### 3. Detail is a self-contained context packet

A sub agent starts with no memory of the conversation or `plan.md`. Every `detail` uses these labeled sections (`Contract` may be omitted only when no interface is involved; `plan_validate` warns on the others):

```text
Goal: one or two sentences of intended outcome.
Files: files to modify (mirror `files`) and files that must not be touched.
Contract: exact signatures, types, schemas, endpoints, or names to honor; paste them, do not reference.
Steps: concrete ordered steps with every design decision already made.
Verify: exact commands to run and the expected result.
Done when: observable acceptance criteria.
```

No "see plan.md", no "decide the best approach", no "similar to TASK-003". If a decision is open, resolve it during planning or ask the user.

### 4. Task sizing

One task = one coherent change a single sub agent can finish and verify in one session: usually 1 to 5 files. Too small wastes dispatch and context setup; too large loses focus and makes review hard. Aim for 3 to 6 parallel tasks per wave. Split a task that owns unrelated files; merge tasks that always touch the same file.

### 5. Role hints

Set `agent` on every task. Use `explore` only when an investigation result is a real prerequisite that planning could not settle; prefer resolving it during planning. Use `review` or `verify` for the closing task.

## Required planning deliverables

Produce `plan.md` and one phase JSON file per ordered phase. Include actionable tasks, dependencies, acceptance or verification criteria, risks and mitigations, unresolved questions, and a definition of done. Confirm all files are inside the intended project and referenced paths exist.

After writing or editing any phase JSON, run both commands and iterate until `plan_validate` prints `Plan valid` with no errors:

```bash
ppm plan_validate --plan <plan-name> [--project <project-path>]
ppm plan_waves --plan <plan-name> [--project <project-path>]
```

- `plan_validate` errors (schema, cycles, concurrent file overlap) must be fixed. Warnings (serial phase, missing ownership, missing context-packet sections, no closing task, no agent hint) should be fixed or justified in the report. `--strict` treats warnings as errors.
- `plan_waves` shows waves per phase, critical path, peak width, and average parallelism. If most waves have width 1, or the critical path equals the task count, restructure: remove false dependencies, split tasks, or merge phases.

Report changed files, unresolved questions, and the final `plan_validate` and `plan_waves` output as verification.

## Supporting commands

Run from the target project root, or add `--project <project-path>`:

```bash
ppm init [--project <project-path>]
ppm init --plan <plan-name> [--project <project-path>]
ppm plan_validate --plan <plan-name> [--project <project-path>]
ppm plan_status --plan <plan-name> [--project <project-path>]
ppm plan_waves --plan <plan-name> [--project <project-path>]
ppm migrate [--project <project-path>] [--dry-run]
ppm clean_roots [--dry-run]
```

Run `ppm migrate --dry-run` before `ppm migrate`. Run `ppm clean_roots --dry-run` before `ppm clean_roots`. `plan_init` remains a compatibility alias for `init --plan`.
