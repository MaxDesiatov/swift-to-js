import { assignmentExpression, objectExpression, callExpression, objectProperty, functionExpression, blockStatement, returnStatement, arrayExpression, numericLiteral, identifier, stringLiteral, thisExpression, nullLiteral, memberExpression, Expression, Identifier, MemberExpression, NullLiteral, ThisExpression, Statement } from "babel-types";

import { addVariable, undefinedLiteral, uniqueIdentifier, emitScope, newScope, rootScope, mangleName, fullPathOfScope, Scope } from "./scope";
import { parse as parseType, Type } from "./types";

export type ArgGetter = (index: number | "this", desiredName?: string) => Value;

export interface ExpressionValue {
	kind: "expression";
	expression: Expression;
	pointer?: boolean;
}

export function expr(expression: Identifier | ThisExpression, pointer?: boolean): VariableValue;
export function expr(expression: Expression, pointer?: boolean): ExpressionValue | VariableValue;
export function expr(expression: Expression, pointer: boolean = false): ExpressionValue | ReturnType<typeof variable> {
	if (expression.type === "Identifier" || expression.type === "ThisExpression" || (expression.type === "MemberExpression" && isPure(expression.object) && (!expression.computed || isPure(expression.property)))) {
		return variable(expression);
	}
	return { kind: "expression", expression, pointer };
}


export interface StatementsValue {
	kind: "statements";
	statements: Statement[];
}

export function statements(statements: Statement[]): StatementsValue | ReturnType<typeof expr> {
	if (statements.length === 1) {
		const firstStatement = statements[0];
		if (firstStatement.type === "ReturnStatement") {
			return expr(firstStatement.argument === null ? undefinedLiteral : firstStatement.argument);
		}
	}
	return {
		kind: "statements",
		statements,
	};
}

export interface CallableValue {
	kind: "callable";
	call: (scope: Scope, arg: ArgGetter) => Value;
	type: Type;
}

export function callable(call: (scope: Scope, arg: ArgGetter) => Value, type: Type): CallableValue {
	return { kind: "callable", call, type };
}


export interface VariableValue {
	kind: "direct";
	ref: Identifier | MemberExpression | ThisExpression;
}

export function variable(ref: Identifier | MemberExpression | ThisExpression): VariableValue {
	return { kind: "direct", ref };
}


export interface BoxedValue {
	kind: "boxed";
	contents: VariableValue;
}

export function boxed(contents: Value): BoxedValue {
	if (contents.kind !== "direct") {
		throw new TypeError(`Unable to box a $(contents.kind)}`);
	}
	return { kind: "boxed", contents };
}


export interface FunctionValue {
	kind: "function";
	name: string;
	type: Type;
}

export function functionValue(name: string, type: Type): FunctionValue {
	return { kind: "function", name, type };
}


export interface TupleValue {
	kind: "tuple";
	values: Value[];
}

export function tuple(values: Value[]): TupleValue {
	return { kind: "tuple", values };
}

export type Value = ExpressionValue | CallableValue | VariableValue | FunctionValue | TupleValue | BoxedValue | StatementsValue;


export type StructField = {
	name: string;
	type: Type;
} & ({ stored: true } | { stored: false; getter: (target: Value, scope: Scope) => Value; });

export function structField(name: string, type: Type | string, getter?: (target: Value, scope: Scope) => Value): StructField {
	const resolvedType = typeof type === "string" ? parseType(type) : type;
	if (getter) {
		return {
			name,
			type: resolvedType,
			stored: false,
			getter,
		}
	}
	return {
		name,
		type: resolvedType,
		stored: true,
	};
}


const baseProperty = identifier("base");
const offsetProperty = identifier("offset");

export function newPointer(base: Expression, offset: Expression): Value {
	return expr(objectExpression([objectProperty(baseProperty, base), objectProperty(offsetProperty, offset)]), true);
}

export function unbox(value: Value, scope: Scope): VariableValue {
	if (value.kind === "expression") {
		if (value.pointer) {
			const [first, second] = reuseExpression(value.expression, scope);
			return variable(memberExpression(memberExpression(first, baseProperty), memberExpression(second, offsetProperty), true));
		} else {
			console.log(value);
			throw new Error(`Unable to unbox an expression that's not a pointer`);
		}
	} else if (value.kind === "boxed") {
		return value.contents;
	} else if (value.kind === "direct") {
		return value;
	} else {
		throw new Error(`Unable to unbox from ${value.kind} value as pointer`);
	}
}

function getArgumentPointers(type: Type): boolean[] {
	if (type.kind === "function") {
		return type.arguments.types.map((arg) => arg.kind === "modified" && arg.modifier === "inout");
	}
	throw new TypeError(expectedMessage("function", type));
}

export function functionize(scope: Scope, type: Type, expression: (scope: Scope, arg: ArgGetter) => Value): Expression {
	const inner: Scope = newScope("anonymous", scope);
	inner.mapping["self"] = thisExpression();
	let usedCount = 0;
	const identifiers: { [index: number]: Identifier } = Object.create(null);
	const pointers = getArgumentPointers(type);
	const newValue = expression(inner, (i, name) => {
		if (usedCount === -1) {
			throw new Error(`Requested access to scope after it was generated!`);
		}
		if (i === "this") {
			return expr(thisExpression());
		}
		if (usedCount <= i) {
			usedCount = i + 1;
		}
		let result: Identifier;
		if (Object.hasOwnProperty.call(identifiers, i)) {
			result = identifiers[i];
		} else {
			result = identifiers[i] = identifier(typeof name === "string" ? name : "$" + i);
		}
		return expr(result, pointers[i]);
	});
	const args: Identifier[] = [];
	for (let i = 0; i < usedCount; i++) {
		args[i] = Object.hasOwnProperty.call(identifiers, i) ? identifiers[i] : identifier("$" + i);
	}
	let statements: Statement[];
	if (newValue.kind === "statements") {
		statements = newValue.statements;
	} else {
		statements = [returnStatement(read(newValue, inner))];
	}
	const result = functionExpression(undefined, args, blockStatement(emitScope(inner, statements)));
	usedCount = -1;
	return result;
}

export function insertFunction(name: string, scope: Scope, type: Type): Identifier {
	const mangled = mangleName(name);
	const globalScope = rootScope(scope);
	addVariable(globalScope, mangled, functionize(globalScope, type, (inner, arg) => scope.functions[name](inner, arg, type, name)));
	return mangled;
}


export function read(value: VariableValue, scope: Scope): Identifier | MemberExpression;
export function read(value: Value, scope: Scope): Expression;
export function read(value: Value, scope: Scope): Expression {
	switch (value.kind) {
		case "function":
			return insertFunction(value.name, scope, value.type);
		case "tuple":
			return arrayExpression(value.values.map((child) => read(child, scope)));
		case "expression":
			if (value.pointer) {
				const [first, second] = reuseExpression(value.expression, scope);
				return memberExpression(memberExpression(first, baseProperty), memberExpression(second, offsetProperty), true);
			} else {
				return value.expression;
			}
		case "callable":
			return functionize(scope, value.type, value.call);
		case "direct":
			return value.ref;
		case "statements":
			return callExpression(functionExpression(undefined, [], blockStatement(value.statements)), []);
		case "boxed":
			if (value.contents.kind === "direct") {
				const ref = value.contents.ref;
				switch (ref.type) {
					case "Identifier":
						return identifier("unboxable$" + ref.name);
					case "ThisExpression":
						return identifier("unboxable$this");
					case "MemberExpression":
						return read(newPointer(ref.object, ref.computed ? ref.property : stringLiteral((ref.property as Identifier).name)), scope);					
				}
			// } else if (value.contents.kind === "expression") {
			// 	if (value.contents.pointer) {
			// 		return value.contents;
			// 	}
			// 	return newPointer(arrayExpression([value.contents.expression]), numericLiteral(0));
			}
			throw new Error(`Unable to box a ${value.contents.kind} value as pointer`);
	}
}

export function call(target: Value, args: Value[], scope: Scope): Value {
	const getter: ArgGetter = (i) => {
		if (i === "this") {
			return expr(undefinedLiteral);
		}
		if (i < args.length) {
			return args[i];
		}
		throw new Error(`${target.kind === "function" ? target.name : "Callable"} asked for argument ${i}, but only ${args.length} arguments provided!`);
	}
	switch (target.kind) {
		case "function":
			// return call(expr(insertFunction(target.name, scope, target.type)), args, scope);
			return scope.functions[target.name](scope, getter, target.type, target.name);
		case "callable":
			return target.call(scope, getter);
		default:
			return expr(callExpression(read(target, scope), args.map((value) => read(value, scope))));
	}
}

function isPure(expression: Expression): boolean {
	switch (expression.type) {
		case "Identifier":
		case "StringLiteral":
		case "BooleanLiteral":
		case "NumericLiteral":
		case "NullLiteral":
		case "ThisExpression":
			return true;
		case "MemberExpression":
			return isPure(expression.property) && (!expression.computed || isPure(expression.property));
		case "ArrayExpression":
			for (const element of expression.elements) {
				if (element !== null) {
					if (element.type === "SpreadElement" || !isPure(element)) {
						return false;
					}
				}
			}
			return true;
		default:
			return false;
	}
}

export function reuseExpression(expression: Expression, scope: Scope): [Expression, Expression] {
	if (isPure(expression)) {
		return [expression, expression];
	} else {
		const temp = uniqueIdentifier(scope);
		return [assignmentExpression("=", temp, expression), temp];
	}
}

export function hoistToIdentifier(expression: Expression, scope: Scope): Identifier | ThisExpression {
	if (expression.type === "Identifier" || expression.type === "ThisExpression") {
		return expression;
	}
	const result = uniqueIdentifier(scope);
	addVariable(scope, result, expression);
	return result;
}

function expectedMessage(name: string, type: Type) {
	return `Expected a ${name}, got a ${type.kind}: ${stringifyType(type)}`;
}

export function stringifyType(type: Type): string {
	switch (type.kind) {
		case "optional":
			return stringifyType(type.type) + "?";
		case "generic":
			return stringifyType(type.base) + "<" + type.arguments.map(stringifyType).join(", ") + ">";
		case "function":
			// TODO: Handle attributes
			return stringifyType(type.arguments) + (type.throws ? " throws" : "") + (type.rethrows ? " rethrows" : "") + " -> " + stringifyType(type.return);
		case "tuple":
			return "(" + type.types.map(stringifyType) + ")";
		case "array":
			return "[" + stringifyType(type.type) + "]";
		case "dictionary":
			return "[" + stringifyType(type.keyType) + ": " + stringifyType(type.valueType) + "]";
		case "metatype":
			return stringifyType(type.base) + "." + type.as;
		case "modified":
			return type.modifier + " " + stringifyType(type.type);
		case "namespaced":
			return stringifyType(type.namespace) + "." + stringifyType(type.type);
		case "name":
			return type.name;
	}
}
