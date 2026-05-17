/**
 * POST to `${env.TURSO_DATABASE_URL}/v2/pipeline` with `Authorization: Bearer ${env.TURSO_AUTH_TOKEN}`. Sends all statements in a single HTTP request for bulk insert.
 *
 * @param {object} env - Workers env with `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
 * @param {Array<{sql:string, args?:Array}>} statements - SQL statements to execute in one pipeline.
 * @returns {Promise<object>} Turso pipeline response JSON.
 */
export function tursoPipeline(env, statements) {
  // TODO: build pipeline payload and POST to /v2/pipeline
}
