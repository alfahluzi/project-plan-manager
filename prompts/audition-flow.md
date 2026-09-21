# Audition Flow

Use this flow to audit or review a plan before execution. Read this file in full before acting. Audition is read-only unless the user separately requests fixes.

## Resolve and inspect safely

Resolve `<project-path>` and `<plan-name>`. Do not initialize or register anything during the audit. Pass `--project <project-path>` to CLI commands when explicit project resolution is needed. If the plan or required files do not exist, report that evidence and return `not_ready`; do not create them. Inspect `<project-path>/.ppm/<plan-name>/plan.md`. Enumerate `tasks/phase_*.json` filenames to establish phase order, without relying on filename order alone.

For complete consistency checks, use the CLI exclusively for phase task data:

```bash
ppm task_list --plan <name> --phase <phase_x> [--project <project-path>]
ppm task_get_detail --plan <name> --phase <phase_x> --task-id <id> [--project <project-path>]
ppm task_get_progress --plan <name> --phase <phase_x> --task-id <id> [--project <project-path>]
```

Do not call status or progress mutation commands. Never mark a task, write progress, or rewrite the plan during an audition.

## Audit criteria

Assess:

- objective and scope clarity;
- source requirement traceability;
- assumptions versus verified facts;
- phase ordering and dependencies;
- task atomicity and actionability;
- stable IDs and valid `todo|in_progress|completed|fail` statuses;
- plan-to-task and task-to-deliverable coverage;
- acceptance and verification specificity;
- referenced-path existence;
- risks and mitigations;
- feasibility;
- security and privacy;
- rollback or migration needs where applicable;
- execution readiness.

Do not invent requirements. Avoid implementation redesign beyond plan scope.

## Findings and output

Classify every finding as `blocker`, `major`, `minor`, or `note`. Include exact phase/task IDs and evidence where applicable. Distinguish `verified defect`, `ambiguity/open question`, and `recommendation`.

Output:

1. Verdict: exactly `ready`, `ready_with_minor_changes`, or `not_ready`.
2. Summary counts by severity.
3. Ordered findings, with type, severity, IDs, evidence, and impact.
4. Uncovered requirements.
5. Open questions.
6. Recommended remediation.
7. Commands and evidence used.

Do not mutate task status, write progress, initialize/register the project, or rewrite plan data unless the user separately asks for fixes. Report missing prerequisites and any failed read-only command.
