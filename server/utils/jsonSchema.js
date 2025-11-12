// server/utils/jsonSchema.js
// Utility for validating strict JSON outputs (LLM or inbound API)

import Ajv from 'ajv';

/**
 * Create a reusable JSON Schema validator.
 * @param {object} schema - JSON Schema object.
 * @param {string} [name='schema'] - Optional schema name for debug logs.
 */
export function createValidator(schema, name = 'schema') {
  const ajv = new Ajv({ allErrors: true, strict: false, removeAdditional: 'failing' });
  const validate = ajv.compile(schema);

  return (data) => {
    const valid = validate(data);
    if (valid) return { ok: true, data };

    const errors = (validate.errors || []).map((e) => ({
      path: e.instancePath || e.dataPath || '',
      message: e.message || '',
      keyword: e.keyword,
      schemaPath: e.schemaPath,
    }));
    return { ok: false, errors, message: `Invalid ${name}: ${errors.map((e) => e.message).join('; ')}` };
  };
}

/**
 * Validate and parse a JSON string against a schema.
 * Returns { ok, data } or { ok:false, error }.
 */
export function parseAndValidate(jsonStr, schema, name = 'schema') {
  try {
    const parsed = JSON.parse(jsonStr);
    const validate = createValidator(schema, name);
    const res = validate(parsed);
    if (!res.ok) return { ok: false, error: res.message, errors: res.errors };
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${String(e.message || e)}` };
  }
}
