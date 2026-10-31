function validCoordinate(value, minimum, maximum) {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validateCoordinates(coordinates) {
    return validCoordinate(coordinates.pickup_lat, -90, 90) &&
        validCoordinate(coordinates.pickup_lon, -180, 180) &&
        validCoordinate(coordinates.drop_lat, -90, 90) &&
        validCoordinate(coordinates.drop_lon, -180, 180) &&
        !(coordinates.pickup_lat === coordinates.drop_lat && coordinates.pickup_lon === coordinates.drop_lon);
}

function normalizeLocation(value) {
    return typeof value === 'string' ? value.trim().toLocaleLowerCase('en-US') : '';
}

function validateRouteMetrics(distanceKm, durationMinutes, maxDistanceKm = 200, maxDurationMinutes = 600) {
    if (
        typeof distanceKm !== 'number' ||
        !Number.isFinite(distanceKm) ||
        distanceKm <= 0 ||
        distanceKm > maxDistanceKm ||
        typeof durationMinutes !== 'number' ||
        !Number.isFinite(durationMinutes) ||
        durationMinutes < 0 ||
        durationMinutes > maxDurationMinutes
    ) {
        return `distance_km must be greater than 0 and no greater than ${maxDistanceKm}; duration_minutes must be non-negative and no greater than ${maxDurationMinutes}.`;
    }
    return null;
}

function validateSettings(settings) {
    return Boolean(
        typeof settings.platform_name === 'string' &&
        settings.platform_name.trim() &&
        settings.platform_name.trim().length <= 100 &&
        typeof settings.support_email === 'string' &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.support_email.trim()) &&
        Number.isFinite(Number(settings.driver_commission_percentage)) &&
        Number(settings.driver_commission_percentage) >= 0 &&
        Number(settings.driver_commission_percentage) <= 100 &&
        Number.isFinite(Number(settings.max_search_radius_km)) &&
        Number(settings.max_search_radius_km) > 0 &&
        Number(settings.max_search_radius_km) <= 200 &&
        typeof settings.maintenance_mode === 'boolean' &&
        typeof settings.booking_enabled === 'boolean'
    );
}

module.exports = {
    validCoordinate,
    validateCoordinates,
    normalizeLocation,
    validateRouteMetrics,
    validateSettings
};
