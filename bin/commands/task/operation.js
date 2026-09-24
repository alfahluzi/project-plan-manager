"use strict";

const { createOperation } = require("../../createOperation");
const {
	taskListHandler,
	taskReadyHandler,
	taskBlockedHandler,
	taskGetHandler,
	taskWriteProgressHandler,
	setTaskStatus,
	validateProgressText,
} = require("./helper");

const taskOptions = ["project", "plan", "phase", "task-id"];
const taskIdRequired = ["plan", "phase", "task-id"];

module.exports = [
	createOperation({
		name: "task_list",
		usage: "ppm task_list --plan <name> --phase <phase_x> [--project <path>]",
		handler: taskListHandler,
		options: ["project", "plan", "phase"],
		required: ["plan", "phase"],
	}),

	createOperation({
		name: "task_ready",
		usage: "ppm task_ready --plan <name> --phase <phase_x> [--project <path>]",
		handler: taskReadyHandler,
		options: ["project", "plan", "phase"],
		required: ["plan", "phase"],
	}),

	createOperation({
		name: "task_blocked",
		usage: "ppm task_blocked --plan <name> --phase <phase_x> [--project <path>]",
		handler: taskBlockedHandler,
		options: ["project", "plan", "phase"],
		required: ["plan", "phase"],
	}),

	createOperation({
		name: "task_get",
		usage: "ppm task_get --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		handler: taskGetHandler,
		options: taskOptions,
		required: taskIdRequired,
	}),

	createOperation({
		name: "task_in_progress",
		usage: "ppm task_in_progress --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		handler: (options) => setTaskStatus(options, "in_progress"),
		options: taskOptions,
		required: taskIdRequired,
	}),

	createOperation({
		name: "task_completed",
		usage: "ppm task_completed --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		handler: (options) => setTaskStatus(options, "completed"),
		options: taskOptions,
		required: taskIdRequired,
	}),

	createOperation({
		name: "task_fail",
		usage: "ppm task_fail --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		handler: (options) => setTaskStatus(options, "fail"),
		options: taskOptions,
		required: taskIdRequired,
	}),

	createOperation({
		name: "task_reset",
		usage: "ppm task_reset --plan <name> --phase <phase_x> --task-id <id> [--project <path>]",
		handler: (options) => setTaskStatus(options, "todo"),
		options: taskOptions,
		required: taskIdRequired,
	}),

	createOperation({
		name: "task_write_progress",
		usage: "ppm task_write_progress --plan <name> --phase <phase_x> --task-id <id> --progress-text <text> [--project <path>]",
		handler: taskWriteProgressHandler,
		options: ["project", "plan", "phase", "task-id", "progress-text"],
		required: ["plan", "phase", "task-id", "progress-text"],
		validators: { "progress-text": validateProgressText },
	}),
];