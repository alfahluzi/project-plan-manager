# Execution Flow

Use this flow for executing, continuing, or resuming a plan. Read this file in full before acting. Use `ppm` as the exclusive interface for reading and changing phase task data; do not manually read phase JSON with generic file tools.

## Initialize and order

Resolve `<project-path>` and `<plan-name>`. Before writing plan files, initialize the target plan:

```bash
ppm init --plan <plan-name> [--project <project-path>]
```

Enumerate phase filenames only to determine order. Start at `phase_0`; process phases in numeric order without skipping. Do not use memory or `plan.md` to claim completion.

## Mandatory task loop

1. Call `ppm task_list --plan <name> --phase <phase_x>`.
2. Skip only tasks with status `completed`. For the first non-completed task, call `ppm task_get_detail` and `ppm task_get_progress`.
3. If status is `in_progress`, resume from recorded progress. If status is `todo` or `fail`, immediately call:

   ```bash
   ppm task_in_progress --plan <name> --phase <phase_x> --task-id <id>
   ```

4. Execute only that task according to its detail and project instructions.
5. Record meaningful verification context with `ppm task_write_progress`.
6. On success call `ppm task_completed`. On failure write failure context, call `ppm task_fail`, and stop unless the user explicitly requests continuation.
7. Call `ppm task_list` again. Repeat until every task in the phase is `completed`.
8. Continue to the next phase. Stop only when the final phase is complete.

The only valid statuses are `todo`, `in_progress`, `completed`, and `fail`. Preserve task identity and stable IDs. Do not rewrite task data with generic file tools.

## Completion report

Confirm final phase completion through `ppm task_list`. Report changed files, statuses, verification evidence, unresolved questions, failures, and whether the plan is complete.

## Execution command reference

```bash
ppm task_list --plan <name> --phase phase_0
ppm task_get_progress --plan <name> --phase phase_0 --task-id TASK-001
ppm task_get_detail --plan <name> --phase phase_0 --task-id TASK-001
ppm task_in_progress --plan <name> --phase phase_0 --task-id TASK-001
ppm task_completed --plan <name> --phase phase_0 --task-id TASK-001
ppm task_fail --plan <name> --phase phase_0 --task-id TASK-001
ppm task_reset --plan <name> --phase phase_0 --task-id TASK-001
ppm task_write_progress --plan <name> --phase phase_0 --task-id TASK-001 --progress-text "Implemented endpoint; verification passed."
```

`task_list` is the authoritative ordered task view. `task_get_progress` returns Title, Status, and Progress. `task_get_detail` returns Title, Status, and Detail. Status commands return `Task status updated`; progress writes return `progress updated`.
