interface D1Options {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

interface D1Response<T> {
  success: boolean;
  errors: { message: string }[];
  result: { results: T; success: boolean; meta: Record<string, unknown> }[];
}

interface RawResults {
  columns: string[];
  rows: unknown[][];
}

export function createD1({ accountId, databaseId, apiToken }: D1Options): D1Database {
  async function query<T>(path: 'query' | 'raw', sql: string, params: unknown[]) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    });
    const body = (await res.json()) as D1Response<T>;
    if (!res.ok || !body.success) throw new Error(`D1 ${path} failed: ${body.errors?.map((error) => error.message).join(', ') || res.status}`);
    return body.result[0];
  }

  class Statement {
    constructor(
      private readonly sql: string,
      private readonly params: unknown[] = []
    ) {}

    bind(...params: unknown[]) {
      return new Statement(this.sql, params);
    }

    async all() {
      const { results, success, meta } = await query<unknown[]>('query', this.sql, this.params);
      return { results, success, meta };
    }

    async run() {
      const { success, meta } = await query<unknown[]>('query', this.sql, this.params);
      return { results: [], success, meta };
    }

    async first(column?: string) {
      const { results } = await query<Record<string, unknown>[]>('query', this.sql, this.params);
      const row = results[0] ?? null;
      return column && row ? row[column] : row;
    }

    async raw(options?: { columnNames?: boolean }) {
      const { results } = await query<RawResults>('raw', this.sql, this.params);
      return options?.columnNames ? [results.columns, ...results.rows] : results.rows;
    }
  }

  return {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      return results;
    },
  } as unknown as D1Database;
}
