/**
 * Unit tests for server.js utility functions
 * Run with: npm test
 */

const assert = require('assert');

// ============ Test Utilities ============

// Copy of functions from server.js for testing
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

function extractBase64Data(data) {
    if (typeof data !== 'string') return '';
    if (data.startsWith('data:') && data.includes(',')) return data.split(',')[1];
    return data;
}

function estimateBytesFromBase64(base64Data) {
    if (!base64Data) return 0;
    const padding = base64Data.endsWith('==') ? 2 : (base64Data.endsWith('=') ? 1 : 0);
    return Math.floor((base64Data.length * 3) / 4) - padding;
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

function validateAndNormalizeAttachments(attachments) {
    if (!attachments) return [];
    if (!Array.isArray(attachments)) {
        throw new Error('Attachments must be an array');
    }
    if (attachments.length > MAX_ATTACHMENTS) {
        throw new Error(`Too many attachments (max ${MAX_ATTACHMENTS})`);
    }

    let totalBytes = 0;
    const normalized = [];

    for (const att of attachments) {
        if (!att || typeof att !== 'object') {
            throw new Error('Invalid attachment format');
        }

        const base64Data = extractBase64Data(att.data);
        if (!base64Data) {
            throw new Error('Attachment data is missing');
        }

        const bytes = estimateBytesFromBase64(base64Data);
        if (bytes <= 0) {
            throw new Error('Attachment data is invalid');
        }
        if (bytes > MAX_ATTACHMENT_SIZE_BYTES) {
            throw new Error(`Attachment exceeds max size (${Math.round(MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024)}MB)`);
        }

        totalBytes += bytes;
        if (totalBytes > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
            throw new Error(`Total attachment size exceeds ${Math.round(MAX_TOTAL_ATTACHMENT_SIZE_BYTES / 1024 / 1024)}MB`);
        }

        normalized.push({
            name: typeof att.name === 'string' && att.name.trim() ? att.name.trim().slice(0, 255) : 'attachment',
            type: typeof att.type === 'string' && att.type.trim() ? att.type.trim().slice(0, 100) : 'application/octet-stream',
            data: base64Data
        });
    }

    return normalized;
}

function sanitizeErrorMessage(error, fallbackMessage = 'An error occurred') {
    const IS_PRODUCTION = process.env.NODE_ENV === 'production';
    if (!IS_PRODUCTION) {
        return error instanceof Error ? error.message : String(error);
    }
    return fallbackMessage;
}

// ============ Tests ============

describe('isValidUUID', () => {
    it('should return true for valid UUIDs', () => {
        assert.strictEqual(isValidUUID('550e8400-e29b-41d4-a716-446655440000'), true);
        assert.strictEqual(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), true);
        assert.strictEqual(isValidUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479'), true);
    });

    it('should return false for invalid UUIDs', () => {
        assert.strictEqual(isValidUUID('not-a-uuid'), false);
        assert.strictEqual(isValidUUID('550e8400-e29b-41d4-a716'), false);
        assert.strictEqual(isValidUUID(''), false);
        assert.strictEqual(isValidUUID(null), false);
        assert.strictEqual(isValidUUID(undefined), false);
        assert.strictEqual(isValidUUID(123), false);
    });
});

describe('extractBase64Data', () => {
    it('should extract base64 from data URL', () => {
        assert.strictEqual(
            extractBase64Data('data:image/png;base64,iVBORw0KGgo='),
            'iVBORw0KGgo='
        );
        assert.strictEqual(
            extractBase64Data('data:text/plain;base64,SGVsbG8='),
            'SGVsbG8='
        );
    });

    it('should return raw string if not a data URL', () => {
        assert.strictEqual(extractBase64Data('SGVsbG8='), 'SGVsbG8=');
        assert.strictEqual(extractBase64Data('rawdata'), 'rawdata');
    });

    it('should return empty string for non-strings', () => {
        assert.strictEqual(extractBase64Data(null), '');
        assert.strictEqual(extractBase64Data(undefined), '');
        assert.strictEqual(extractBase64Data(123), '');
        assert.strictEqual(extractBase64Data({}), '');
    });
});

describe('estimateBytesFromBase64', () => {
    it('should estimate bytes correctly', () => {
        // "Hello" = 5 bytes, base64 = "SGVsbG8="
        assert.strictEqual(estimateBytesFromBase64('SGVsbG8='), 5);
        // "Hi" = 2 bytes, base64 = "SGk="
        assert.strictEqual(estimateBytesFromBase64('SGk='), 2);
        // "A" = 1 byte, base64 = "QQ=="
        assert.strictEqual(estimateBytesFromBase64('QQ=='), 1);
    });

    it('should return 0 for empty or null input', () => {
        assert.strictEqual(estimateBytesFromBase64(''), 0);
        assert.strictEqual(estimateBytesFromBase64(null), 0);
        assert.strictEqual(estimateBytesFromBase64(undefined), 0);
    });
});

describe('validateAndNormalizeAttachments', () => {
    it('should return empty array for null/undefined', () => {
        assert.deepStrictEqual(validateAndNormalizeAttachments(null), []);
        assert.deepStrictEqual(validateAndNormalizeAttachments(undefined), []);
    });

    it('should throw for non-array input', () => {
        assert.throws(() => validateAndNormalizeAttachments('string'), /must be an array/);
        assert.throws(() => validateAndNormalizeAttachments({}), /must be an array/);
    });

    it('should throw for too many attachments', () => {
        const tooMany = Array(6).fill({ name: 'test', type: 'text/plain', data: 'SGVsbG8=' });
        assert.throws(() => validateAndNormalizeAttachments(tooMany), /Too many attachments/);
    });

    it('should normalize valid attachments', () => {
        const input = [{
            name: 'test.txt',
            type: 'text/plain',
            data: 'data:text/plain;base64,SGVsbG8='
        }];
        const result = validateAndNormalizeAttachments(input);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].name, 'test.txt');
        assert.strictEqual(result[0].type, 'text/plain');
        assert.strictEqual(result[0].data, 'SGVsbG8=');
    });

    it('should use defaults for missing name/type', () => {
        const input = [{ data: 'SGVsbG8=' }];
        const result = validateAndNormalizeAttachments(input);
        assert.strictEqual(result[0].name, 'attachment');
        assert.strictEqual(result[0].type, 'application/octet-stream');
    });

    it('should throw for missing data', () => {
        assert.throws(() => validateAndNormalizeAttachments([{ name: 'test' }]), /data is missing/);
    });

    it('should truncate long names', () => {
        const longName = 'a'.repeat(300);
        const input = [{ name: longName, data: 'SGVsbG8=' }];
        const result = validateAndNormalizeAttachments(input);
        assert.strictEqual(result[0].name.length, 255);
    });
});

describe('sanitizeErrorMessage', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    it('should return error message in development', () => {
        process.env.NODE_ENV = 'development';
        const error = new Error('Detailed error info');
        assert.strictEqual(sanitizeErrorMessage(error, 'Generic error'), 'Detailed error info');
    });

    it('should return fallback in production', () => {
        process.env.NODE_ENV = 'production';
        const error = new Error('Detailed error info');
        assert.strictEqual(sanitizeErrorMessage(error, 'Generic error'), 'Generic error');
    });

    it('should handle string errors', () => {
        process.env.NODE_ENV = 'development';
        assert.strictEqual(sanitizeErrorMessage('String error', 'Fallback'), 'String error');
    });
});

// ============ Run Tests ============

// Simple test runner
console.log('Running server.js unit tests...\n');

function describe(name, fn) {
    console.log(`\n${name}`);
    afterEach._fn = null;
    fn();
    afterEach._fn = null;
}

function it(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (error) {
        console.log(`  ✗ ${name}`);
        console.log(`    ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (typeof afterEach._fn === 'function') {
            try { afterEach._fn(); } catch (e) {}
        }
    }
}

function afterEach(fn) {
    afterEach._fn = fn;
}