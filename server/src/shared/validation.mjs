export const VALIDATION_ERROR_CODE = "VALIDATION_ERROR";

function fieldPath(issue) {
  return (issue.path || []).map((part) => String(part)).join(".");
}

function issueCode(issue) {
  return String(issue.code || "invalid");
}

export function flattenZodFields(error) {
  return (error?.issues || []).map((issue) => ({
    path: fieldPath(issue),
    code: issueCode(issue),
    message: issue.message || "Invalid value",
  }));
}

export function formatZodError(error) {
  const first = flattenZodFields(error)[0];
  if (!first) return "Invalid request payload.";
  return first.path ? `${first.path}: ${first.message}` : first.message;
}

export function validationFailure(error) {
  return {
    ok: false,
    status: 400,
    body: {
      detail: formatZodError(error),
      code: VALIDATION_ERROR_CODE,
      fields: flattenZodFields(error),
    },
  };
}

export function parseRequest(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return validationFailure(result.error);
}
