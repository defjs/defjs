export class HttpContextToken<T> {
	constructor(public readonly defaultValue: () => T) {}
}

const ContextMap = Symbol('ContextMap')

export class HttpContext {
	private readonly [ContextMap] = new Map<HttpContextToken<unknown>, unknown>()

	set<T>(token: HttpContextToken<T>, value: T): HttpContext {
		this[ContextMap].set(token, value)
		return this
	}

	get<T>(token: HttpContextToken<T>): T {
		if (!this[ContextMap].has(token)) {
			this[ContextMap].set(token, token.defaultValue())
		}
		return this[ContextMap].get(token) as T
	}

	delete(token: HttpContextToken<unknown>): HttpContext {
		this[ContextMap].delete(token)
		return this
	}

	has(token: HttpContextToken<unknown>): boolean {
		return this[ContextMap].has(token)
	}

	keys(): IterableIterator<HttpContextToken<unknown>> {
		return this[ContextMap].keys()
	}
}
