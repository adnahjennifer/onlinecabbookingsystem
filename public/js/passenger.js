/**
 * CabGo - Online Cab Booking System
 * Passenger Dashboard Controller (Day 4 - Member 1)
 *
 * Implements:
 * 1. Session verification on load with GET /api/me and role guard.
 * 2. Real fare estimation for standard, sedan, and suv cabs using Promise.all.
 * 3. Booking creation via POST /api/ride-requests with server-computed fares.
 * 4. Real ride requests listing via GET /api/ride-requests/mine with normalization.
 * 5. Active booking card with live driver/vehicle details and status progression.
 * 6. Leak-free polling (~10s) with document visibility pause/resume and status change banners.
 * 7. Cancellation via POST /api/ride-requests/:id/cancel (requested status only).
 * 8. Trip history table (completed/cancelled) formatted with en-IN locale and stats cards.
 *
 * STRICT SECURITY: Zero innerHTML with server data (XSS prevention).
 */

"use strict";

(function () {
    // Temporary route distance and duration estimates until real route mapping is integrated.
    // These placeholder values match backend/server.js so the fare shown to the passenger
    // equals the fare stored in the database.
    const DEFAULT_ESTIMATED_DISTANCE_KM = 10;
    const DEFAULT_ESTIMATED_DURATION_MINUTES = 20;

    // Friendly status descriptions for passenger UI
    const STATUS_DESCRIPTIONS = {
        requested: "Looking for a driver...",
        accepted: "Driver is on the way",
        started: "Trip in progress",
        completed: "Trip completed",
        cancelled: "Cancelled"
    };

    // Resolve helper references safely from window
    const API_CONFIG = (typeof window !== "undefined" && window.API_CONFIG) ? window.API_CONFIG : (typeof API_CONFIG !== "undefined" ? API_CONFIG : {});
    const getSession = (typeof window !== "undefined" && window.getSession) ? window.getSession : () => null;
    const saveSession = (typeof window !== "undefined" && window.saveSession) ? window.saveSession : () => {};
    const clearSession = (typeof window !== "undefined" && window.clearSession) ? window.clearSession : () => {};
    const normalizeUser = (typeof window !== "undefined" && window.normalizeUser) ? window.normalizeUser : (u) => u;
    const formatFare = (typeof window !== "undefined" && window.formatFare) ? window.formatFare : (n) => `₹${Number(n).toFixed(2)}`;
    const getErrorMessage = (typeof window !== "undefined" && window.getErrorMessage) ? window.getErrorMessage : (d, fb) => (d && (d.message || (d.error && d.error.message))) || fb;
    const apiRequest = (typeof window !== "undefined" && window.apiRequest) ? window.apiRequest : () => Promise.resolve({ ok: false, status: 0 });
    const showMessage = (typeof window !== "undefined" && window.showMessage) ? window.showMessage : () => {};

    // Polling interval reference for active bookings
    let statusPollingTimer = null;

    // Currently selected ride for confirmation modal
    let pendingRide = null;

    // Booking targeted for cancellation
    let pendingCancelBookingId = null;

    // Cached bookings array
    let currentBookings = [];

    // Track active booking between polls to detect status transitions (e.g. to completed/cancelled)
    let lastActiveBookingId = null;
    let lastActiveBookingStatus = null;

    // Is booking submission in flight
    let isBookingPending = false;

    // Is cancellation in flight
    let isCancellingPending = false;

    /* ==========================================================================
       Normalization Helper
       ========================================================================== */

    /**
     * Normalizes a server ride request into a consistent UI booking shape.
     * Defensively handles missing driver, vehicle, final_fare, started_at, completed_at.
     * @param {Object} item - Raw request object from server.
     * @returns {Object|null} Normalized booking object.
     */
    function normalizeBooking(item) {
        if (!item || typeof item !== "object") {
            return null;
        }

        const requestId = item.request_id !== undefined ? item.request_id : item.id;
        const estFare = item.estimated_fare !== undefined && item.estimated_fare !== null
            ? parseFloat(item.estimated_fare)
            : 0;
        const finFare = item.final_fare !== undefined && item.final_fare !== null
            ? parseFloat(item.final_fare)
            : null;

        let driver = null;
        if (item.driver && typeof item.driver === "object") {
            driver = {
                full_name: item.driver.full_name || item.driver.name || "",
                rating: item.driver.rating !== undefined && item.driver.rating !== null ? item.driver.rating : null,
                phone: item.driver.phone || null
            };
        }

        let vehicle = null;
        if (item.vehicle && typeof item.vehicle === "object") {
            vehicle = {
                model: item.vehicle.model || "",
                registration_number: item.vehicle.registration_number || "",
                vehicle_type: item.vehicle.vehicle_type || item.vehicle_type || ""
            };
        }

        return {
            request_id: requestId,
            pickup_location: item.pickup_location || "",
            drop_location: item.drop_location || "",
            vehicle_type: (item.vehicle_type || "standard").toLowerCase(),
            estimated_fare: estFare,
            final_fare: finFare,
            status: (item.status || "requested").toLowerCase(),
            created_at: item.created_at || new Date().toISOString(),
            driver: driver,
            vehicle: vehicle,
            started_at: item.started_at || null,
            completed_at: item.completed_at || null
        };
    }

    /* ==========================================================================
       Initialization & Session Verification
       ========================================================================== */

    document.addEventListener("DOMContentLoaded", async function () {
        const session = getSession();

        // 1. Synchronous check: Ensure session exists in sessionStorage
        if (!session || !session.user) {
            window.location.replace("login.html");
            return;
        }

        const cachedUser = normalizeUser(session.user);
        if (cachedUser.role && cachedUser.role !== "passenger") {
            const roleRedirects = {
                driver: "driver/dashboard.html",
                admin: "admin/dashboard.html",
                super_admin: "superadmin/dashboard.html"
            };
            window.location.replace(roleRedirects[cachedUser.role] || "login.html");
            return;
        }

        // Display initial passenger name from cached session
        const greetingEl = document.getElementById("passengerName");
        if (greetingEl) {
            greetingEl.textContent = cachedUser.name || cachedUser.full_name || "Passenger";
        }

        // Initialize event handlers
        initSearchForm();
        initBookingConfirmationModal();
        initCancellationModal();
        initVisibilityHandling();

        // 2. Real session verification with GET /api/me
        try {
            const meRes = await apiRequest(API_CONFIG.ENDPOINTS.me || "/api/me", "GET");
            if (!meRes.ok || meRes.status === 401) {
                clearSession();
                window.location.replace("login.html");
                return;
            }

            const verifiedUser = meRes.data && meRes.data.user ? normalizeUser(meRes.data.user) : null;
            if (!verifiedUser || (verifiedUser.role && verifiedUser.role !== "passenger")) {
                const roleRedirects = {
                    driver: "driver/dashboard.html",
                    admin: "admin/dashboard.html",
                    super_admin: "superadmin/dashboard.html"
                };
                window.location.replace((verifiedUser && roleRedirects[verifiedUser.role]) || "login.html");
                return;
            }

            // Sync verified user data in session storage
            saveSession(verifiedUser, session.token || null);
            if (greetingEl) {
                greetingEl.textContent = verifiedUser.name || verifiedUser.full_name || "Passenger";
            }
        } catch (err) {
            // Network failure will be handled by apiRequest or offline states
        }

        // Initial fetch of bookings and active status
        await fetchBookings();

        // Clear polling timer on page unload
        window.addEventListener("beforeunload", stopStatusPolling);
    });

    /**
     * Pauses status polling when document is hidden and resumes when visible.
     */
    function initVisibilityHandling() {
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) {
                stopStatusPolling();
            } else {
                const hasActive = currentBookings.some((b) =>
                    ["requested", "accepted", "started"].includes(b.status)
                );
                if (hasActive) {
                    fetchBookings();
                    startStatusPolling();
                }
            }
        });
    }

    /* ==========================================================================
       1. Cab Search Form & Fare Estimation
       ========================================================================== */

    function initSearchForm() {
        const searchForm = document.getElementById("searchForm");
        const pickupInput = document.getElementById("pickup");
        const destinationInput = document.getElementById("destination");
        const searchBtn = document.getElementById("searchSubmitBtn");
        const searchMessage = document.getElementById("searchMessage");
        const resultsSection = document.getElementById("searchResultsSection");
        const cardsGrid = document.getElementById("rideCardsGrid");

        if (!searchForm) {
            return;
        }

        searchForm.addEventListener("submit", async function (event) {
            event.preventDefault();

            const pickup = pickupInput ? pickupInput.value.trim() : "";
            const destination = destinationInput ? destinationInput.value.trim() : "";

            // Hide previous messages and results
            if (searchMessage) {
                searchMessage.hidden = true;
                searchMessage.textContent = "";
            }
            if (resultsSection) {
                resultsSection.hidden = true;
            }
            if (cardsGrid) {
                cardsGrid.textContent = "";
            }

            // Route validation: both required, must differ, max 255 chars
            if (!pickup || !destination) {
                showMessage(searchMessage, "Please enter both pickup and destination locations.", "error");
                if (!pickup && pickupInput) {
                    pickupInput.focus();
                } else if (!destination && destinationInput) {
                    destinationInput.focus();
                }
                return;
            }

            if (pickup.length > 255 || destination.length > 255) {
                showMessage(searchMessage, "Location addresses must be less than 255 characters.", "error");
                return;
            }

            if (pickup.toLowerCase() === destination.toLowerCase()) {
                showMessage(searchMessage, "Pickup and destination locations must be different.", "error");
                if (destinationInput) {
                    destinationInput.focus();
                }
                return;
            }

            // Set loading state
            searchBtn.disabled = true;
            searchBtn.setAttribute("aria-busy", "true");
            const originalBtnText = searchBtn.textContent;
            searchBtn.textContent = "Calculating Fares...";

            try {
                const vehicleTypes = ["standard", "sedan", "suv"];
                const farePromises = vehicleTypes.map((type) =>
                    apiRequest(
                        API_CONFIG.ENDPOINTS.fareEstimate || "/api/fare/estimate",
                        "POST",
                        {
                            vehicle_type: type,
                            distance_km: DEFAULT_ESTIMATED_DISTANCE_KM,
                            duration_minutes: DEFAULT_ESTIMATED_DURATION_MINUTES
                        }
                    )
                );

                const responses = await Promise.all(farePromises);

                const successfulRides = [];
                let failedCount = 0;
                let lastError = null;

                responses.forEach((res, index) => {
                    if (res.ok && res.data && res.data.estimated_fare !== undefined) {
                        successfulRides.push({
                            vehicle_type: res.data.vehicle_type || vehicleTypes[index],
                            estimated_fare: Number(res.data.estimated_fare),
                            estimated_distance_km: res.data.distance_km || DEFAULT_ESTIMATED_DISTANCE_KM,
                            estimated_minutes: res.data.duration_minutes || DEFAULT_ESTIMATED_DURATION_MINUTES
                        });
                    } else {
                        failedCount++;
                        lastError = res;
                    }
                });

                if (successfulRides.length === 0) {
                    const fallbackMsg = lastError && lastError.status === 0
                        ? "Cannot reach the server. Please check your connection."
                        : "Failed to calculate cab fares. Please try again.";
                    const errorMsg = lastError ? getErrorMessage(lastError.data, fallbackMsg) : fallbackMsg;
                    showMessage(searchMessage, errorMsg, "error");
                    return;
                }

                if (failedCount > 0) {
                    showMessage(
                        searchMessage,
                        "Note: Some vehicle categories are temporarily unavailable.",
                        "info"
                    );
                }

                renderSearchResults(successfulRides, pickup, destination);
            } catch (err) {
                showMessage(searchMessage, "An unexpected error occurred while calculating fares.", "error");
            } finally {
                searchBtn.disabled = false;
                searchBtn.removeAttribute("aria-busy");
                searchBtn.textContent = originalBtnText;
            }
        });
    }

    /**
     * Renders cab search result cards safely using document.createElement.
     * Note: Available driver count is omitted as real backend does not provide it.
     * @param {Array} rides
     * @param {string} pickup
     * @param {string} destination
     */
    function renderSearchResults(rides, pickup, destination) {
        const resultsSection = document.getElementById("searchResultsSection");
        const cardsGrid = document.getElementById("rideCardsGrid");

        if (!resultsSection || !cardsGrid) {
            return;
        }

        cardsGrid.textContent = "";

        if (rides.length === 0) {
            const emptyDiv = document.createElement("div");
            emptyDiv.className = "empty-state";

            const p = document.createElement("p");
            p.textContent = "No cabs are currently available for this route. Please try again shortly.";
            emptyDiv.appendChild(p);

            cardsGrid.appendChild(emptyDiv);
            resultsSection.hidden = false;
            return;
        }

        rides.forEach((ride) => {
            const card = document.createElement("article");
            card.className = "ride-card";

            // Header: Vehicle type & badge
            const header = document.createElement("div");
            header.className = "ride-card-header";

            const typeTitle = document.createElement("h5");
            typeTitle.className = "ride-card-type";
            typeTitle.textContent = ride.vehicle_type || "Standard";

            const typeBadge = document.createElement("span");
            typeBadge.className = "badge";
            typeBadge.textContent = (ride.vehicle_type || "Cab").toUpperCase();
            header.appendChild(typeTitle);
            header.appendChild(typeBadge);

            // Fare display
            const fareEl = document.createElement("div");
            fareEl.className = "ride-card-fare";
            fareEl.textContent = formatFare(ride.estimated_fare);

            // Distance & time meta
            const metaEl = document.createElement("div");
            metaEl.className = "ride-card-meta";

            const distStr = ride.estimated_distance_km ? `${ride.estimated_distance_km} km` : "";
            const timeStr = ride.estimated_minutes ? `${ride.estimated_minutes} mins` : "";
            const combinedDistTime = [distStr, timeStr].filter(Boolean).join(" • ");

            if (combinedDistTime) {
                const pDist = document.createElement("p");
                pDist.style.margin = "0";
                pDist.textContent = combinedDistTime;
                metaEl.appendChild(pDist);
            }

            // Book button
            const bookBtn = document.createElement("button");
            bookBtn.type = "button";
            bookBtn.className = "button";
            bookBtn.textContent = `Book ${ride.vehicle_type ? ride.vehicle_type.charAt(0).toUpperCase() + ride.vehicle_type.slice(1) : "Ride"}`;
            bookBtn.addEventListener("click", function () {
                openBookingConfirmationModal({
                    pickup: pickup,
                    destination: destination,
                    vehicle_type: ride.vehicle_type || "standard",
                    estimated_fare: ride.estimated_fare,
                    estimated_distance_km: ride.estimated_distance_km,
                    estimated_minutes: ride.estimated_minutes
                });
            });

            // Assemble card
            card.appendChild(header);
            card.appendChild(fareEl);
            card.appendChild(metaEl);
            card.appendChild(bookBtn);

            cardsGrid.appendChild(card);
        });

        resultsSection.hidden = false;
        resultsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    /* ==========================================================================
       2. In-Page Booking Confirmation Modal
       ========================================================================== */

    function initBookingConfirmationModal() {
        const modal = document.getElementById("confirmBookingModal");
        const confirmBtn = document.getElementById("confirmBookingBtn");
        const cancelBtn = document.getElementById("cancelConfirmBtn");

        if (!modal || !confirmBtn || !cancelBtn) {
            return;
        }

        cancelBtn.addEventListener("click", closeBookingConfirmationModal);

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !modal.hidden) {
                closeBookingConfirmationModal();
            }
        });

        confirmBtn.addEventListener("click", handleConfirmBookingSubmission);
    }

    /**
     * Opens the in-page confirmation panel with selected ride details.
     * @param {Object} rideDetails
     */
    function openBookingConfirmationModal(rideDetails) {
        pendingRide = rideDetails;

        const modal = document.getElementById("confirmBookingModal");
        const modalMsg = document.getElementById("confirmModalMessage");
        const pickupEl = document.getElementById("confirmPickup");
        const destinationEl = document.getElementById("confirmDestination");
        const vehicleTypeEl = document.getElementById("confirmVehicleType");
        const distanceEl = document.getElementById("confirmDistance");
        const durationEl = document.getElementById("confirmDuration");
        const fareEl = document.getElementById("confirmFare");
        const confirmBtn = document.getElementById("confirmBookingBtn");

        if (modalMsg) {
            modalMsg.hidden = true;
            modalMsg.textContent = "";
        }

        if (pickupEl) {
            pickupEl.textContent = rideDetails.pickup;
        }
        if (destinationEl) {
            destinationEl.textContent = rideDetails.destination;
        }
        if (vehicleTypeEl) {
            vehicleTypeEl.textContent = rideDetails.vehicle_type;
        }
        if (distanceEl) {
            distanceEl.textContent = rideDetails.estimated_distance_km
                ? `${rideDetails.estimated_distance_km} km`
                : `${DEFAULT_ESTIMATED_DISTANCE_KM} km`;
        }
        if (durationEl) {
            durationEl.textContent = rideDetails.estimated_minutes
                ? `${rideDetails.estimated_minutes} mins`
                : `${DEFAULT_ESTIMATED_DURATION_MINUTES} mins`;
        }
        if (fareEl) {
            fareEl.textContent = formatFare(rideDetails.estimated_fare);
        }

        if (modal) {
            modal.hidden = false;
        }
        if (confirmBtn) {
            confirmBtn.focus();
        }
    }

    function closeBookingConfirmationModal() {
        const modal = document.getElementById("confirmBookingModal");
        if (modal) {
            modal.hidden = true;
        }
        pendingRide = null;
        isBookingPending = false;

        const confirmBtn = document.getElementById("confirmBookingBtn");
        const cancelBtn = document.getElementById("cancelConfirmBtn");
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.removeAttribute("aria-busy");
            confirmBtn.textContent = "Confirm Booking";
        }
        if (cancelBtn) {
            cancelBtn.disabled = false;
        }
    }

    /**
     * Handles the actual booking submission to POST /api/ride-requests.
     * Server calculates estimated fare itself; do NOT send estimated_fare.
     */
    async function handleConfirmBookingSubmission() {
        if (!pendingRide || isBookingPending) {
            return;
        }

        const confirmBtn = document.getElementById("confirmBookingBtn");
        const cancelBtn = document.getElementById("cancelConfirmBtn");
        const modalMsg = document.getElementById("confirmModalMessage");
        const bookingMessage = document.getElementById("bookingMessage");

        // Prevent double booking / double clicks
        isBookingPending = true;
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.setAttribute("aria-busy", "true");
            confirmBtn.textContent = "Confirming...";
        }
        if (cancelBtn) {
            cancelBtn.disabled = true;
        }

        try {
            // POST /api/ride-requests with only pickup_location, drop_location, and vehicle_type
            const payload = {
                pickup_location: pendingRide.pickup,
                drop_location: pendingRide.destination,
                vehicle_type: pendingRide.vehicle_type
            };

            const endpoint = API_CONFIG.ENDPOINTS.rideRequests || API_CONFIG.ENDPOINTS.bookings || "/api/ride-requests";
            const response = await apiRequest(endpoint, "POST", payload);

            if (response.status === 401) {
                clearSession();
                window.location.replace("login.html");
                return;
            }

            if (!response.ok) {
                const errorMsg = getErrorMessage(
                    response.data,
                    response.status === 0
                        ? "Cannot reach the server. Please check your connection."
                        : "Failed to confirm booking. Please try again."
                );
                showMessage(modalMsg, errorMsg, "error");
                return;
            }

            // Booking created successfully: read from data.request (or fallback data.booking)
            const created = response.data && (response.data.request || response.data.booking);
            const bookingId = created ? created.request_id : "";
            const confirmedFare = created && created.estimated_fare !== undefined
                ? formatFare(created.estimated_fare)
                : formatFare(pendingRide.estimated_fare);

            closeBookingConfirmationModal();

            // Clear search form and results
            const searchForm = document.getElementById("searchForm");
            if (searchForm) {
                searchForm.reset();
            }
            const searchResults = document.getElementById("searchResultsSection");
            if (searchResults) {
                searchResults.hidden = true;
            }

            // Show success message on the dashboard with server returned fare
            if (bookingMessage) {
                const successText = bookingId
                    ? `Booking #${bookingId} confirmed successfully! Estimated fare: ${confirmedFare}. Looking for a nearby driver...`
                    : `Booking confirmed successfully! Estimated fare: ${confirmedFare}. Looking for a nearby driver...`;
                showMessage(bookingMessage, successText, "success");
            }

            // Immediate refresh of bookings, active section, stats & history
            await fetchBookings();

            // Smooth scroll to current booking section
            const currentBookingCard = document.getElementById("currentBookingCard");
            if (currentBookingCard) {
                currentBookingCard.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        } catch (err) {
            showMessage(modalMsg, "An error occurred while confirming your booking.", "error");
        } finally {
            isBookingPending = false;
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.removeAttribute("aria-busy");
                confirmBtn.textContent = "Confirm Booking";
            }
            if (cancelBtn) {
                cancelBtn.disabled = false;
            }
        }
    }

    /* ==========================================================================
       3. Fetch Bookings, Active Status Card & Polling
       ========================================================================== */

    /**
     * Checks if a previously active booking transitioned to completed or cancelled between polls.
     * Displays a one-time status banner when detected.
     * @param {Array} bookings
     */
    function checkStatusTransition(bookings) {
        if (!lastActiveBookingId) {
            return;
        }

        const prev = bookings.find((b) => b.request_id === lastActiveBookingId);
        if (prev && lastActiveBookingStatus && ["requested", "accepted", "started"].includes(lastActiveBookingStatus)) {
            const bookingMsg = document.getElementById("bookingMessage");
            if (prev.status === "completed") {
                if (bookingMsg) {
                    showMessage(bookingMsg, `Your trip #${prev.request_id} has been completed.`, "success");
                }
            } else if (prev.status === "cancelled") {
                if (bookingMsg) {
                    showMessage(bookingMsg, `Your booking #${prev.request_id} has been cancelled.`, "info");
                }
            }
        }
    }

    /**
     * Fetches all passenger bookings from GET /api/ride-requests/mine and updates UI.
     */
    async function fetchBookings() {
        try {
            const endpoint = API_CONFIG.ENDPOINTS.myRideRequests || API_CONFIG.ENDPOINTS.bookings || "/api/ride-requests/mine";
            const response = await apiRequest(endpoint, "GET");

            if (response.status === 401) {
                clearSession();
                window.location.replace("login.html");
                return;
            }

            if (!response.ok) {
                const bookingMsg = document.getElementById("bookingMessage");
                if (bookingMsg && bookingMsg.hidden) {
                    showMessage(
                        bookingMsg,
                        getErrorMessage(response.data, "Unable to refresh bookings. Retrying shortly..."),
                        "error"
                    );
                }
                return;
            }

            const rawList = response.data && (
                Array.isArray(response.data.requests)
                    ? response.data.requests
                    : (Array.isArray(response.data.bookings) ? response.data.bookings : [])
            );

            const bookings = (rawList || []).map(normalizeBooking).filter(Boolean);

            checkStatusTransition(bookings);

            currentBookings = bookings;

            updateStats(bookings);
            updateTripHistoryTable(bookings);
            updateActiveBookingSection(bookings);
        } catch (err) {
            // Silently handle polling errors to avoid interrupting user interaction
        }
    }

    /**
     * Updates the Active Booking card dynamically.
     * @param {Array} bookings
     */
    function updateActiveBookingSection(bookings) {
        const container = document.getElementById("activeBookingContent");
        if (!container) {
            return;
        }

        // Find active booking: requested, accepted, or started
        const activeBooking = bookings.find((b) =>
            ["requested", "accepted", "started"].includes(b.status)
        );

        container.textContent = "";

        if (!activeBooking) {
            // No active booking: stop polling and show empty state
            stopStatusPolling();
            lastActiveBookingId = null;
            lastActiveBookingStatus = null;

            const emptyDiv = document.createElement("div");
            emptyDiv.className = "empty-state";

            const iconSpan = document.createElement("span");
            iconSpan.className = "empty-state-icon";
            iconSpan.setAttribute("aria-hidden", "true");
            iconSpan.textContent = "🚗";

            const p1 = document.createElement("p");
            p1.style.fontWeight = "bold";
            p1.textContent = "No Active Booking";

            const p2 = document.createElement("p");
            p2.textContent = "You don't have any ongoing rides. Search and book a cab above to get started.";

            emptyDiv.appendChild(iconSpan);
            emptyDiv.appendChild(p1);
            emptyDiv.appendChild(p2);
            container.appendChild(emptyDiv);
            return;
        }

        // An active booking exists: record state for transitions and ensure polling is running
        lastActiveBookingId = activeBooking.request_id;
        lastActiveBookingStatus = activeBooking.status;

        if (!document.hidden) {
            startStatusPolling();
        }

        const detailsDiv = document.createElement("div");
        detailsDiv.className = "active-booking-details";

        // Row 1: Status badge & friendly description
        const statusBadge = document.createElement("span");
        statusBadge.className = `badge badge-status-${activeBooking.status}`;
        statusBadge.textContent = activeBooking.status.toUpperCase();

        const friendlyStatus = STATUS_DESCRIPTIONS[activeBooking.status] || activeBooking.status;
        const rowStatus = createDetailRow("Status", friendlyStatus, statusBadge);
        detailsDiv.appendChild(rowStatus);

        // Row 2: Booking ID
        const rowId = createDetailRow("Booking ID", `#${activeBooking.request_id}`);
        detailsDiv.appendChild(rowId);

        // Row 3: Route (Pickup & Drop)
        const rowPickup = createDetailRow("Pickup Location", activeBooking.pickup_location);
        const rowDrop = createDetailRow("Destination", activeBooking.drop_location);
        detailsDiv.appendChild(rowPickup);
        detailsDiv.appendChild(rowDrop);

        // Row 4: Vehicle Type & Fare
        const rowVehicle = createDetailRow(
            "Vehicle Type",
            activeBooking.vehicle_type
                ? activeBooking.vehicle_type.charAt(0).toUpperCase() + activeBooking.vehicle_type.slice(1)
                : "Standard"
        );
        const fareLabel = activeBooking.final_fare != null ? "Final Fare" : "Estimated Fare";
        const fareAmount = activeBooking.final_fare != null ? activeBooking.final_fare : activeBooking.estimated_fare;
        const rowFare = createDetailRow(fareLabel, formatFare(fareAmount));
        detailsDiv.appendChild(rowVehicle);
        detailsDiv.appendChild(rowFare);

        // Driver & Vehicle details section
        if (activeBooking.driver || activeBooking.vehicle) {
            const driverBox = document.createElement("div");
            driverBox.className = "driver-info-box";

            const boxTitle = document.createElement("h4");
            boxTitle.textContent = "Assigned Driver & Vehicle";
            driverBox.appendChild(boxTitle);

            if (activeBooking.driver) {
                const pDriver = document.createElement("p");
                const strongDriver = document.createElement("strong");
                strongDriver.textContent = "Driver: ";
                pDriver.appendChild(strongDriver);
                pDriver.appendChild(document.createTextNode(activeBooking.driver.full_name || "Assigned Driver"));

                if (activeBooking.driver.rating) {
                    const ratingSpan = document.createElement("span");
                    ratingSpan.style.color = "#d97706";
                    ratingSpan.style.marginLeft = "8px";
                    ratingSpan.textContent = `★ ${parseFloat(activeBooking.driver.rating).toFixed(1)}`;
                    pDriver.appendChild(ratingSpan);
                }
                driverBox.appendChild(pDriver);
            }

            if (activeBooking.vehicle) {
                const pVehicle = document.createElement("p");
                const strongVehicle = document.createElement("strong");
                strongVehicle.textContent = "Vehicle: ";
                pVehicle.appendChild(strongVehicle);
                const vehModel = activeBooking.vehicle.model || "Cab";
                const vehPlate = activeBooking.vehicle.registration_number ? ` (${activeBooking.vehicle.registration_number})` : "";
                pVehicle.appendChild(document.createTextNode(`${vehModel}${vehPlate}`));
                driverBox.appendChild(pVehicle);
            }

            detailsDiv.appendChild(driverBox);
        } else {
            const waitingBox = document.createElement("div");
            waitingBox.className = "driver-waiting-box";
            waitingBox.textContent = "Waiting for a driver to accept your ride request...";
            detailsDiv.appendChild(waitingBox);
        }

        // Cancellation Button: only allowed for status 'requested'
        // Backend restricts cancellation to 'requested'; accepted rides return 404
        if (activeBooking.status === "requested") {
            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "button danger";
            cancelBtn.style.marginTop = "14px";
            cancelBtn.textContent = "Cancel Booking";
            cancelBtn.addEventListener("click", function () {
                openCancellationModal(activeBooking.request_id);
            });
            detailsDiv.appendChild(cancelBtn);
        }

        container.appendChild(detailsDiv);
    }

    /**
     * Helper to create a two-column detail row for booking info.
     * @param {string} label
     * @param {string} value
     * @param {HTMLElement} [extraEl]
     * @returns {HTMLElement}
     */
    function createDetailRow(label, value, extraEl) {
        const row = document.createElement("div");
        row.className = "booking-detail-row";

        const labelSpan = document.createElement("span");
        labelSpan.className = "booking-detail-label";
        labelSpan.textContent = label;

        const valueSpan = document.createElement("span");
        valueSpan.className = "booking-detail-value";
        valueSpan.textContent = value;

        if (extraEl) {
            valueSpan.appendChild(document.createTextNode(" "));
            valueSpan.appendChild(extraEl);
        }

        row.appendChild(labelSpan);
        row.appendChild(valueSpan);
        return row;
    }

    /**
     * Starts polling active bookings list every ~10s if not already running.
     * Ensures intervals are never duplicated.
     */
    function startStatusPolling() {
        if (!statusPollingTimer) {
            statusPollingTimer = setInterval(fetchBookings, 10000);
        }
    }

    /**
     * Stops and clears the active polling timer.
     */
    function stopStatusPolling() {
        if (statusPollingTimer) {
            clearInterval(statusPollingTimer);
            statusPollingTimer = null;
        }
    }

    /* ==========================================================================
       4. Booking Cancellation Modal & Action
       ========================================================================== */

    function initCancellationModal() {
        const modal = document.getElementById("cancelBookingModal");
        const confirmBtn = document.getElementById("confirmCancelBtn");
        const abortBtn = document.getElementById("abortCancelBtn");

        if (!modal || !confirmBtn || !abortBtn) {
            return;
        }

        abortBtn.addEventListener("click", closeCancellationModal);

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !modal.hidden) {
                closeCancellationModal();
            }
        });

        confirmBtn.addEventListener("click", handleConfirmCancellation);
    }

    /**
     * Opens cancellation modal for the targeted booking.
     * @param {number|string} requestId
     */
    function openCancellationModal(requestId) {
        pendingCancelBookingId = requestId;

        const modal = document.getElementById("cancelBookingModal");
        const modalMsg = document.getElementById("cancelModalMessage");
        const confirmBtn = document.getElementById("confirmCancelBtn");

        if (modalMsg) {
            modalMsg.hidden = true;
            modalMsg.textContent = "";
        }

        if (modal) {
            modal.hidden = false;
        }
        if (confirmBtn) {
            confirmBtn.focus();
        }
    }

    function closeCancellationModal() {
        const modal = document.getElementById("cancelBookingModal");
        if (modal) {
            modal.hidden = true;
        }
        pendingCancelBookingId = null;
        isCancellingPending = false;

        const confirmBtn = document.getElementById("confirmCancelBtn");
        const abortBtn = document.getElementById("abortCancelBtn");
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.removeAttribute("aria-busy");
            confirmBtn.textContent = "Yes, Cancel Booking";
        }
        if (abortBtn) {
            abortBtn.disabled = false;
        }
    }

    /**
     * Sends POST /api/ride-requests/:id/cancel request.
     */
    async function handleConfirmCancellation() {
        if (!pendingCancelBookingId || isCancellingPending) {
            return;
        }

        const confirmBtn = document.getElementById("confirmCancelBtn");
        const abortBtn = document.getElementById("abortCancelBtn");
        const modalMsg = document.getElementById("cancelModalMessage");
        const bookingMessage = document.getElementById("bookingMessage");

        isCancellingPending = true;
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.setAttribute("aria-busy", "true");
            confirmBtn.textContent = "Cancelling...";
        }
        if (abortBtn) {
            abortBtn.disabled = true;
        }

        try {
            const cancelUrl = typeof API_CONFIG.getCancelBookingUrl === "function"
                ? API_CONFIG.getCancelBookingUrl(pendingCancelBookingId)
                : `/api/ride-requests/${encodeURIComponent(pendingCancelBookingId)}/cancel`;

            const response = await apiRequest(cancelUrl, "POST");

            if (response.status === 401) {
                clearSession();
                window.location.replace("login.html");
                return;
            }

            if (!response.ok) {
                let errorMsg;
                if (response.status === 404) {
                    errorMsg = "This ride can no longer be cancelled, it may already have been accepted.";
                } else if (response.status === 0) {
                    errorMsg = "Cannot reach the server. Please check your connection.";
                } else {
                    errorMsg = getErrorMessage(response.data, "Failed to cancel booking.");
                }
                showMessage(modalMsg, errorMsg, "error");
                await fetchBookings();
                return;
            }

            const cancelledId = pendingCancelBookingId;
            closeCancellationModal();

            if (bookingMessage) {
                showMessage(bookingMessage, `Booking #${cancelledId} cancelled successfully.`, "success");
            }

            // Refresh UI immediately
            await fetchBookings();
        } catch (err) {
            showMessage(modalMsg, "An error occurred while cancelling your booking.", "error");
        } finally {
            isCancellingPending = false;
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.removeAttribute("aria-busy");
                confirmBtn.textContent = "Yes, Cancel Booking";
            }
            if (abortBtn) {
                abortBtn.disabled = false;
            }
        }
    }

    /* ==========================================================================
       5. Statistics & Trip History Table
       ========================================================================== */

    /**
     * Recomputes and updates the 3 overview stat cards.
     * @param {Array} bookings
     */
    function updateStats(bookings) {
        const totalEl = document.getElementById("statTotalBookings");
        const completedEl = document.getElementById("statCompletedTrips");
        const activeEl = document.getElementById("statActiveBookings");

        const total = bookings.length;
        const completed = bookings.filter((b) => b.status === "completed").length;
        const active = bookings.filter((b) => ["requested", "accepted", "started"].includes(b.status)).length;

        if (totalEl) {
            totalEl.textContent = String(total);
        }
        if (completedEl) {
            completedEl.textContent = String(completed);
        }
        if (activeEl) {
            activeEl.textContent = String(active);
        }
    }

    /**
     * Renders trip history into the table: completed and cancelled trips, newest first.
     * Formats date with toLocaleString("en-IN") and INR currency.
     * @param {Array} bookings
     */
    function updateTripHistoryTable(bookings) {
        const tbody = document.getElementById("tripHistoryBody");
        if (!tbody) {
            return;
        }

        tbody.textContent = "";

        // Filter for completed and cancelled trips (history)
        const pastTrips = bookings.filter((b) => ["completed", "cancelled"].includes(b.status));

        if (pastTrips.length === 0) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 7;
            td.className = "empty-state-cell";
            td.textContent = "No trips yet. Your completed and past rides will appear here.";
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        // Limit to 10 most recent bookings
        const recent = pastTrips.slice(0, 10);

        recent.forEach((trip) => {
            const tr = document.createElement("tr");

            // Trip / Request ID
            const tdId = document.createElement("td");
            tdId.textContent = `#${trip.request_id}`;
            tr.appendChild(tdId);

            // Date (en-IN)
            const tdDate = document.createElement("td");
            let dateStr = "N/A";
            if (trip.created_at) {
                try {
                    dateStr = new Date(trip.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short"
                    });
                } catch (e) {
                    dateStr = String(trip.created_at);
                }
            }
            tdDate.textContent = dateStr;
            tr.appendChild(tdDate);

            // Route
            const tdRoute = document.createElement("td");
            tdRoute.textContent = `${trip.pickup_location || "N/A"} → ${trip.drop_location || "N/A"}`;
            tr.appendChild(tdRoute);

            // Vehicle
            const tdVehicle = document.createElement("td");
            tdVehicle.style.textTransform = "capitalize";
            tdVehicle.textContent = trip.vehicle_type || "Standard";
            tr.appendChild(tdVehicle);

            // Fare
            const tdFare = document.createElement("td");
            const fareAmount = trip.final_fare != null ? trip.final_fare : trip.estimated_fare;
            tdFare.textContent = formatFare(fareAmount);
            tr.appendChild(tdFare);

            // Status Badge
            const tdStatus = document.createElement("td");
            const badge = document.createElement("span");
            badge.className = `badge badge-status-${trip.status}`;
            badge.textContent = (trip.status || "UNKNOWN").toUpperCase();
            tdStatus.appendChild(badge);
            tr.appendChild(tdStatus);

            // Driver Name
            const tdDriver = document.createElement("td");
            tdDriver.textContent = trip.driver && trip.driver.full_name ? trip.driver.full_name : "—";
            tr.appendChild(tdDriver);

            tbody.appendChild(tr);
        });
    }

    // Expose for debugging if needed
    if (typeof window !== "undefined") {
        window.CabGoPassenger = {
            fetchBookings: fetchBookings,
            openBookingConfirmationModal: openBookingConfirmationModal,
            openCancellationModal: openCancellationModal,
            normalizeBooking: normalizeBooking
        };
    }
})();
