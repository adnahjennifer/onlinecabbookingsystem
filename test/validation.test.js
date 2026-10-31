const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validateCoordinates,
    normalizeLocation,
    validateRouteMetrics,
    validateSettings
} = require('../backend/validation');

test('rejects invalid and identical route coordinates', () => {
    assert.equal(validateCoordinates({
        pickup_lat: 13.0, pickup_lon: 80.2, drop_lat: 13.0, drop_lon: 80.2
    }), false);
    assert.equal(validateCoordinates({
        pickup_lat: 13.0, pickup_lon: 80.2, drop_lat: 13.05, drop_lon: 80.25
    }), true);
});

test('normalizes approved location names consistently', () => {
    assert.equal(normalizeLocation('  T. Nagar '), 't. nagar');
});

test('enforces route distance and duration limits', () => {
    assert.equal(validateRouteMetrics(200, 600), null);
    assert.match(validateRouteMetrics(200.1, 10), /no greater than 200/);
    assert.match(validateRouteMetrics(10, 601), /no greater than 600/);
});

test('validates persisted superadmin settings', () => {
    const valid = {
        platform_name: 'CabGo',
        support_email: 'support@example.com',
        driver_commission_percentage: 15,
        max_search_radius_km: 15,
        maintenance_mode: false,
        booking_enabled: true
    };
    assert.equal(validateSettings(valid), true);
    assert.equal(validateSettings({ ...valid, driver_commission_percentage: 101 }), false);
});
