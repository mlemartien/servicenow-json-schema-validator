var JsonSchemaValidator = Class.create();

JsonSchemaValidator.prototype = {

    initialize: function() {
        // Minimal tv4-compatible JSON Schema v4 validator
        // embedded so no external dependencies are needed.
        this._tv4 = this._buildTv4();
    },

    /**
     * Validate a JSON object (already parsed) against a schema object.
     *
     * @param  {Object} data    - The parsed payload object
     * @param  {Object} schema  - A JSON Schema draft-04 object
     * @returns {Object} { valid: Boolean, error: String|null, errors: Array }
     */
    validate: function(data, schema) {
        var result = this._tv4.validateMultiple(data, schema);
        return {
            valid:  result.errors.length === 0,
            error:  result.errors.length > 0 ? result.errors[0].message : null,
            errors: result.errors.map(function(e) {
                return { path: e.dataPath || '/', message: e.message };
            })
        };
    },

    /**
     * Validate a raw JSON string against a schema object.
     *
     * @param  {String} jsonString - Raw JSON body (e.g. from request.body)
     * @param  {Object} schema     - A JSON Schema draft-04 object
     * @returns {Object} { valid: Boolean, error: String|null, errors: Array }
     */
    validateString: function(jsonString, schema) {
        var data;
        try {
            data = JSON.parse(jsonString);
        } catch(e) {
            return { valid: false, error: 'Invalid JSON: ' + e.message, errors: [] };
        }
        return this.validate(data, schema);
    },

    /**
     * Add a reusable sub-schema by URI so schemas can use $ref.
     *
     * @param {String} uri    - e.g. "http://example.com/address"
     * @param {Object} schema - The schema object for that $ref
     */
    addSchema: function(uri, schema) {
        this._tv4.addSchema(uri, schema);
    },

    // ---------------------------------------------------------------
    // Private: build a self-contained tv4-like validator
    // ---------------------------------------------------------------
    _buildTv4: function() {

        var tv4 = {};
        var schemaStore = {};

        tv4.addSchema = function(uri, schema) {
            schemaStore[uri] = schema;
        };

        tv4.validateMultiple = function(data, schema) {
            var errors = [];
            _validate(data, schema, '', errors, schemaStore);
            return { errors: errors };
        };

        function _validate(data, schema, path, errors, store) {
            if (!schema || typeof schema !== 'object') return;

            // $ref resolution
            if (schema['$ref']) {
                var ref = schema['$ref'];
                var resolved = store[ref];
                if (resolved) {
                    _validate(data, resolved, path, errors, store);
                } else {
                    errors.push({ dataPath: path, message: 'Unresolved $ref: ' + ref });
                }
                return;
            }

            // type
            if (schema.type !== undefined) {
                var types = Array.isArray(schema.type) ? schema.type : [schema.type];
                if (!_matchesType(data, types)) {
                    errors.push({
                        dataPath: path,
                        message: 'Expected type ' + types.join('/') + ' but got ' + _typeOf(data)
                    });
                    return; // no point validating further
                }
            }

            // enum
            if (schema['enum'] !== undefined) {
                var found = false;
                for (var ei = 0; ei < schema['enum'].length; ei++) {
                    if (_deepEqual(data, schema['enum'][ei])) { found = true; break; }
                }
                if (!found) {
                    errors.push({ dataPath: path, message: 'Value not in enum at ' + (path || '/') });
                }
            }

            // String keywords
            if (typeof data === 'string') {
                if (schema.minLength !== undefined && data.length < schema.minLength)
                    errors.push({ dataPath: path, message: 'String too short (min ' + schema.minLength + ')' });
                if (schema.maxLength !== undefined && data.length > schema.maxLength)
                    errors.push({ dataPath: path, message: 'String too long (max ' + schema.maxLength + ')' });
                if (schema.pattern !== undefined && !(new RegExp(schema.pattern)).test(data))
                    errors.push({ dataPath: path, message: 'String does not match pattern: ' + schema.pattern });
            }

            // Number keywords
            if (typeof data === 'number') {
                if (schema.minimum !== undefined) {
                    if (schema.exclusiveMinimum ? data <= schema.minimum : data < schema.minimum)
                        errors.push({ dataPath: path, message: 'Value below minimum (' + schema.minimum + ')' });
                }
                if (schema.maximum !== undefined) {
                    if (schema.exclusiveMaximum ? data >= schema.maximum : data > schema.maximum)
                        errors.push({ dataPath: path, message: 'Value above maximum (' + schema.maximum + ')' });
                }
                if (schema.multipleOf !== undefined && data % schema.multipleOf !== 0)
                    errors.push({ dataPath: path, message: 'Value not a multiple of ' + schema.multipleOf });
            }

            // Array keywords
            if (Array.isArray(data)) {
                if (schema.minItems !== undefined && data.length < schema.minItems)
                    errors.push({ dataPath: path, message: 'Array has too few items (min ' + schema.minItems + ')' });
                if (schema.maxItems !== undefined && data.length > schema.maxItems)
                    errors.push({ dataPath: path, message: 'Array has too many items (max ' + schema.maxItems + ')' });
                if (schema.items !== undefined) {
                    if (Array.isArray(schema.items)) {
                        for (var ai = 0; ai < schema.items.length; ai++) {
                            if (ai < data.length)
                                _validate(data[ai], schema.items[ai], path + '/' + ai, errors, store);
                        }
                    } else {
                        for (var aj = 0; aj < data.length; aj++)
                            _validate(data[aj], schema.items, path + '/' + aj, errors, store);
                    }
                }
                if (schema.uniqueItems) {
                    for (var ui = 0; ui < data.length; ui++)
                        for (var uj = ui + 1; uj < data.length; uj++)
                            if (_deepEqual(data[ui], data[uj]))
                                errors.push({ dataPath: path, message: 'Array items are not unique' });
                }
            }

            // Object keywords
            if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
                var keys = Object.keys(data);

                if (schema.required) {
                    for (var ri = 0; ri < schema.required.length; ri++) {
                        if (data[schema.required[ri]] === undefined)
                            errors.push({
                                dataPath: path + '/' + schema.required[ri],
                                message: 'Missing required property: ' + schema.required[ri]
                            });
                    }
                }

                if (schema.minProperties !== undefined && keys.length < schema.minProperties)
                    errors.push({ dataPath: path, message: 'Too few properties (min ' + schema.minProperties + ')' });
                if (schema.maxProperties !== undefined && keys.length > schema.maxProperties)
                    errors.push({ dataPath: path, message: 'Too many properties (max ' + schema.maxProperties + ')' });

                if (schema.additionalProperties === false && schema.properties) {
                    for (var ki = 0; ki < keys.length; ki++) {
                        if (!schema.properties[keys[ki]])
                            errors.push({ dataPath: path + '/' + keys[ki], message: 'Additional property not allowed: ' + keys[ki] });
                    }
                }

                if (schema.properties) {
                    var props = schema.properties;
                    for (var pk in props) {
                        if (data[pk] !== undefined)
                            _validate(data[pk], props[pk], path + '/' + pk, errors, store);
                    }
                }

                if (schema.patternProperties) {
                    for (var pp in schema.patternProperties) {
                        var re = new RegExp(pp);
                        for (var kj = 0; kj < keys.length; kj++) {
                            if (re.test(keys[kj]))
                                _validate(data[keys[kj]], schema.patternProperties[pp], path + '/' + keys[kj], errors, store);
                        }
                    }
                }
            }

            // allOf / anyOf / oneOf / not
            if (schema.allOf) {
                for (var ali = 0; ali < schema.allOf.length; ali++)
                    _validate(data, schema.allOf[ali], path, errors, store);
            }
            if (schema.anyOf) {
                var anyPassed = false;
                for (var ayi = 0; ayi < schema.anyOf.length; ayi++) {
                    var anyErrs = [];
                    _validate(data, schema.anyOf[ayi], path, anyErrs, store);
                    if (anyErrs.length === 0) { anyPassed = true; break; }
                }
                if (!anyPassed)
                    errors.push({ dataPath: path, message: 'Value does not match any of the anyOf schemas' });
            }
            if (schema.oneOf) {
                var oneCount = 0;
                for (var ooi = 0; ooi < schema.oneOf.length; ooi++) {
                    var oneErrs = [];
                    _validate(data, schema.oneOf[ooi], path, oneErrs, store);
                    if (oneErrs.length === 0) oneCount++;
                }
                if (oneCount !== 1)
                    errors.push({ dataPath: path, message: 'Value must match exactly one of the oneOf schemas (matched ' + oneCount + ')' });
            }
            if (schema['not']) {
                var notErrs = [];
                _validate(data, schema['not'], path, notErrs, store);
                if (notErrs.length === 0)
                    errors.push({ dataPath: path, message: 'Value must NOT match the "not" schema' });
            }
        }

        function _typeOf(val) {
            if (val === null) return 'null';
            if (Array.isArray(val)) return 'array';
            return typeof val;
        }

        function _matchesType(val, types) {
            var actual = _typeOf(val);
            for (var i = 0; i < types.length; i++) {
                if (types[i] === actual) return true;
                if (types[i] === 'integer' && typeof val === 'number' && val % 1 === 0) return true;
            }
            return false;
        }

        function _deepEqual(a, b) {
            if (a === b) return true;
            if (typeof a !== typeof b) return false;
            if (a === null || b === null) return false;
            if (Array.isArray(a) && Array.isArray(b)) {
                if (a.length !== b.length) return false;
                for (var i = 0; i < a.length; i++) if (!_deepEqual(a[i], b[i])) return false;
                return true;
            }
            if (typeof a === 'object') {
                var ka = Object.keys(a), kb = Object.keys(b);
                if (ka.length !== kb.length) return false;
                for (var j = 0; j < ka.length; j++) if (!_deepEqual(a[ka[j]], b[kb[j]])) return false;
                return true;
            }
            return false;
        }

        return tv4;
    },

    type: 'JsonSchemaValidator'
};
