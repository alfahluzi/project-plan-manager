"use strict";

const PLAN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PHASE_PATTERN = /^phase_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const VALID_STATUSES = new Set(["todo", "in_progress", "completed", "fail"]);
// Client-agnostic role hints; the orchestrator maps them to whatever sub agents exist.
const VALID_AGENTS = new Set(["explore", "implement", "review", "verify"]);

module.exports = { PLAN_PATTERN, PHASE_PATTERN, VALID_STATUSES, VALID_AGENTS };