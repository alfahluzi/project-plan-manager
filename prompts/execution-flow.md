# Execution Flow

Use this flow for executing, continuing, or resuming a plan. Read this file in full before acting. Use `ppm` as the exclusive interface for reading and changing phase task data; do not read or edit phase JSON with generic file tools.

## Initialize and order

Resolve `<project-path>` and `<plan-name>`. Before writing plan files, initialize the target plan:

```bash
ppm init --plan <plan-name> [--project <project-path>]
```

Get phase order and the current phase from the CLI. Do not use memory, filenames, or `plan.md` to claim completion:

```bash
ppm plan_status --plan <plan-name> [--project <project-path>]
```

Start at the `Current phase` it reports and process phases in numeric order without skipping.

## Mandatory task loop

Phases are processed strictly in numeric order. Inside a phase, tasks with no `pre_request` (or `pre_request: []`) are independent and may run in parallel; tasks with `pre_request` entries must wait until every referenced task reaches `completed`. Plan model: sequential phases, parallelizable tasks within a phase.

1. Call `ppm task_list --plan <name> --phase <phase_x>` to enumerate tasks.
2. Call `ppm task_ready --plan <name> --phase <phase_x>` to obtain the tasks currently eligible to start (status `todo` with all `pre_request` dependencies `completed`). Optionally call `ppm task_blocked` to inspect waiting dependencies.
3. If the ready set is empty and at least one task is still `todo`, stop and wait: every remaining task is blocked on unmet `pre_request` dependencies. Resolve blockers before continuing.
4. For each ready task, call `ppm task_get` to read Title, Status, Detail, and Progress before executing.
5. For each ready task that should advance this turn, call:

   ```bash
   ppm task_in_progress --plan <name> --phase <phase_x> --task-id <id>
   ```

   The CLI rejects this when the task is blocked by unmet `pre_request` or an earlier phase is not fully `completed`. Do not bypass with `--force` unless the user explicitly asks.
6. Execute the task according to its detail and project instructions. Independent ready tasks may be dispatched in parallel by separate agents or background lanes; each lane owns its own task write actions and must not mutate another lane's task. Concurrent writes to the same phase file are serialized by a lock, so parallel lanes do not lose updates.
7. Record meaningful verification context with `ppm task_write_progress`. Each call appends a timestamped entry; pass `--replace` only to deliberately overwrite the whole progress log.
8. On success call `ppm task_completed` (only valid from `in_progress`). On failure write failure context, call `ppm task_fail`, and stop unless the user explicitly requests continuation. A `fail` keeps every task that lists the failed task in its `pre_request` blocked until `ppm task_reset` (back to `todo`) or a retry via `ppm task_in_progress` then `ppm task_completed`.
9. Re-run `ppm task_ready` and `ppm task_list` until every task in the phase is `completed`.
10. Continue to the next phase. Stop only when `ppm plan_status` reports `Current phase: none (plan complete)`.

The only valid statuses are `todo`, `in_progress`, `completed`, and `fail`. Allowed transitions: `todo|fail -> in_progress`, `in_progress -> completed|fail`, `todo -> fail`, and any non-`todo` status `-> todo` via `task_reset`. Preserve task identity and stable IDs.

## Dashboard

Before quoting any dashboard URL to the user, run `ppm check_dashboard [--port <port>]` and act on its output: start a missing server with `ppm dashboard_serve [--project <path>] [--port <port>]`, then re-check and share the verified URL. Never invent a `127.0.0.1:<port>/task.html` URL without that confirmation.

## Completion report

Confirm plan completion through `ppm plan_status`. Report changed files, statuses, verification evidence, unresolved questions, failures, and whether the plan is complete.

## Execution command reference

```bash
ppm plan_status --plan <name>
ppm task_list --plan <name> --phase phase_0
ppm task_ready --plan <name> --phase phase_0
ppm task_blocked --plan <name> --phase phase_0
ppm task_get --plan <name> --phase phase_0 --task-id TASK-001
ppm task_in_progress --plan <name> --phase phase_0 --task-id TASK-001
ppm task_completed --plan <name> --phase phase_0 --task-id TASK-001
ppm task_fail --plan <name> --phase phase_0 --task-id TASK-001
ppm task_reset --plan <name> --phase phase_0 --task-id TASK-001
ppm task_write_progress --plan <name> --phase phase_0 --task-id TASK-001 --progress-text "Implemented endpoint; verification passed."
```

`plan_status` lists phases in order with per-status counts and the current phase. `task_list` is the authoritative ordered task view. `task_ready` lists `todo` tasks whose `pre_request` dependencies are all `completed`: the parallel-eligible candidates for the current phase. `task_blocked` lists `todo` tasks still waiting on unmet `pre_request` items. `task_get` returns Title, Status, Pre-request, Eligibility, Detail, and Progress for one task. Status commands return `Task status updated`; progress writes return `progress updated`. Status commands accept `--force` to skip transition guards (manual repair only).
