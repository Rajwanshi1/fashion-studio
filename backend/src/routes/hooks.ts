// Shared @hono/zod-validator hook: the API contract requires validation errors
// as { error: string } with status 400 (zod-validator's default leaks the raw
// ZodError shape).
export function zodHook(result: any, c: any): any {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    const where = issue?.path?.length ? issue.path.join('.') : 'request';
    const message = issue ? `${where}: ${issue.message}` : 'Invalid request';
    return c.json({ error: message }, 400);
  }
}
