"use strict";

function createOperation(spec) {
	return Object.freeze({
		name: spec.name,
		usage: spec.usage,
		handler: spec.handler,
		options: spec.options ?? [],
		required: spec.required ?? [],
		validators: spec.validators ?? {},
	});
}

function buildRegistry(ops) {
	const byName = new Map();
	const usages = [];
	for (const op of ops) {
		byName.set(op.name, op);
		usages.push(op.usage);
		if (op.aliasFor) byName.set(op.aliasFor, { ...op, name: op.aliasFor });
	}
	return { byName, usages };
}

module.exports = { createOperation, buildRegistry };