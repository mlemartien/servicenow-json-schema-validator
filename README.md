# JsonSchemaValidator — Get your JSON payloads back on track!

A lightweight JSON Schema validation Script Include for ServiceNow, ported from the [tv4](https://github.com/geraintluff/tv4) library. Drop it into any instance and start validating incoming REST API payloads against a JSON Schema in seconds.

---

## Why validate incoming REST API payloads?

When you expose a Scripted REST API in ServiceNow, you are opening a door into your instance. Any system, integration, or developer can call that endpoint — and there is no guarantee the payload they send will be structured the way you expect.

Without validation, a missing required field, an unexpected data type, or a rogue extra property can silently corrupt records, crash business rules, or produce confusing errors that are hard to trace. Catching these problems **at the boundary** — before your logic ever runs — is the safest and cleanest approach.

Validating against a schema gives you:

- **Predictability** — your script always receives the shape of data it was designed for
- **Security** — unexpected properties are rejected before they reach your business logic
- **Meaningful error messages** — callers get a clear `400 Bad Request` with a description of exactly what was wrong, instead of a cryptic `500 Internal Server Error`
- **Self-documentation** — the schema itself becomes a contract that describes what your API accepts

---

## What this Script Include does

`JsonSchemaValidator` is a server-side Script Include that lets you validate any JavaScript object or raw JSON string against a [JSON Schema (draft-04)](https://json-schema.org/specification-links#draft-4) definition. It exposes three simple methods:

| Method | Description |
|---|---|
| `validate(data, schema)` | Validate a parsed object against a schema |
| `validateString(jsonString, schema)` | Parse a raw JSON string and validate it |
| `addSchema(uri, schema)` | Register a reusable sub-schema for use with `$ref` |

Each call returns a result object:

```javascript
{
  valid:  true,          // Boolean — did the payload pass?
  error:  null,          // String  — first error message, or null
  errors: []             // Array   — all errors, each with { path, message }
}
```

---

## Based on the tv4 library

This Script Include is a server-side port of **[tv4 (Tiny Validator for JSON Schema v4)](https://github.com/geraintluff/tv4)**, a well-known open-source JavaScript library by Geraint Luff.

The original tv4 library targets browser and Node.js environments. Since ServiceNow's server-side Rhino/ES engine has no DOM or `require()`, the validation logic has been adapted into a self-contained `Class.create()` Script Include — the standard ServiceNow pattern for reusable server-side code. No external dependencies, no MID server, no npm.

---

## Learn more about JSON Schema

JSON Schema is a vocabulary that lets you annotate and validate JSON documents. It is the industry standard way to describe the structure of a JSON payload.

- **Official specification & guides:** [https://json-schema.org](https://json-schema.org)
- **Interactive learning:** [https://json-schema.org/learn/getting-started-step-by-step](https://json-schema.org/learn/getting-started-step-by-step)
- **Draft-04 specification (used by this Script Include):** [https://json-schema.org/specification-links#draft-4](https://json-schema.org/specification-links#draft-4)
- **Schema examples library:** [https://json-schema.org/learn/miscellaneous-examples](https://json-schema.org/learn/miscellaneous-examples)

---

## Installation

1. In your ServiceNow instance, navigate to **All > System Definition > Script Includes**
2. Click **New**
3. Set the **Name** field to `JsonSchemaValidator`
4. Paste the full script (see [`JsonSchemaValidator.js`](./JsonSchemaValidator.js)) into the **Script** field
5. Make sure **Active** is checked
6. Click **Submit**

---

## Example — Validating a REST API payload

### The scenario

You have a Scripted REST API that creates an Incident. You want to enforce that every incoming payload:

- Is a JSON object
- Has `caller_id` and `short_description` (required)
- Has an `impact` and an `urgency` that is an integer between 1 and 5
- Has a `category` that is one of a fixed set of allowed values
- Does not include any unexpected extra properties

### The schema

```javascript
var schema = {
  "type": "object",
  "required": ["caller_id", "short_description"],
  "additionalProperties": false,
  "properties": {
    "caller_id": {
      "type": "string",
      "minLength": 1
    },
    "short_description": {
      "type": "string",
      "maxLength": 160
    },
    "impact": {
        "type": "integer",
        "minimum": 1,
        "maximum": 3
    },
    "urgency": {
        "type": "integer",
        "minimum": 1,
        "maximum": 3
    },
    "category": {
      "type": "string",
      "enum": ["inquiry", "software", "hardware", "network"]
    }
  }
};
```

### The Scripted REST API resource script

```javascript
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    var schema = {
        "type": "object",
        "required": ["caller_id", "short_description"],
        "additionalProperties": false,
        "properties": {
            "caller_id": {
                "type": "string",
                "minLength": 1
            },
            "short_description": {
                "type": "string",
                "maxLength": 160
            },
            "impact": {
                "type": "integer",
                "minimum": 1,
                "maximum": 3
            },
            "urgency": {
                "type": "integer",
                "minimum": 1,
                "maximum": 3
            },
            "category": {
                "type": "string",
                "enum": ["inquiry", "software", "hardware", "network"]
            }
        }
    };

    // Validate the raw JSON body against the schema
    var validator = new JsonSchemaValidator();
    var result = validator.validateString(request.body.dataString, schema);

    if (!result.valid) {
        response.setStatus(400);
        response.setBody({
            status: "error",
            message: "Payload validation failed",
            errors: result.errors
        });
        return;
    }

    // Safe to use — the payload matches the contract
    var payload = JSON.parse(request.body.dataString);

    var inc = new GlideRecord("incident");
    inc.initialize();
    inc.caller_id.setDisplayValue(payload.caller_id);
    inc.short_description = payload.short_description;
    if (payload.impact) inc.impact = payload.impact;
    if (payload.urgency) inc.urgency = payload.urgency;
    if (payload.category) inc.category = payload.category;
    inc.insert();

    response.setStatus(201);
    response.setBody({
        status: "success",
        sys_id: inc.getUniqueValue()
    });

})(request, response);
```

### Example — valid request

**Request body:**
```json
{
  "caller_id": "Abel Tuter",
  "short_description": "Cannot connect to VPN",
  "impact": 2,
  "urgency": 1,
  "category": "network"
}
```

**Response `200 Created`:**
```json
{
  "status": "success",
  "sys_id": "abc123..."
}
```

### Example — invalid request (missing required field + bad enum value)

**Request body:**
```json
{
  "short_description": "Cannot connect to VPN",
  "category": "coffee"
}
```

**Response `400 Bad Request`:**
```json
{
  "status": "error",
  "message": "Payload validation failed",
  "errors": [
    { "path": "/caller_id",  "message": "Missing required property: caller_id" },
    { "path": "/category",   "message": "Value not in enum at /category" }
  ]
}
```

---

## Supported JSON Schema keywords

| Keyword | Description |
|---|---|
| `type` | string, number, integer, boolean, array, object, null |
| `required` | List of required property names |
| `properties` | Per-property sub-schemas |
| `additionalProperties` | Set to `false` to reject undeclared properties |
| `patternProperties` | Validate properties whose names match a regex |
| `minLength` / `maxLength` | String length constraints |
| `pattern` | Regex pattern for strings |
| `minimum` / `maximum` | Number range (use with `exclusiveMinimum` / `exclusiveMaximum`) |
| `multipleOf` | Number divisibility |
| `minItems` / `maxItems` | Array length constraints |
| `uniqueItems` | Require all array items to be distinct |
| `items` | Schema (or array of schemas) for array elements |
| `minProperties` / `maxProperties` | Object property count constraints |
| `enum` | Restrict value to a fixed list |
| `allOf` / `anyOf` / `oneOf` / `not` | Combining schemas |
| `$ref` | Reference a sub-schema registered via `addSchema()` |

---

## License

This Script Include is derived from [tv4](https://github.com/geraintluff/tv4) by Geraint Luff, released under the [Public Domain / MIT license](https://github.com/geraintluff/tv4/blob/master/LICENSE.txt).

---

## Contributing

Issues and pull requests are welcome. If you add support for additional JSON Schema keywords (e.g. `format` validators, `$schema` resolution, draft-07 features), please open a PR with a test payload demonstrating the new behaviour.
