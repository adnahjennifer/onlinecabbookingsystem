/**
 * CabGo - Online Cab Booking System
 * Passenger Dashboard Controller (Day 5 - Member 1 Polish)
 *
 * Implements:
 * 1. Visual loading states on every Fetch call (spinner and text, button disabling with restore in finally).
 * 2. Robust error handling across all HTTP status codes (400, 401, 403, 404, 409, 500, network failure).
 * 3. Session expiration 401 auto-redirect to login with expired notice.
 * 4. Inline Retry buttons on data load failure preventing blank pages or crashes.
 * 5. Helpful empty states with actionable CTAs for search, active booking, and trip history.
 * 6. In-page cancellation confirmation modal with booking details, focus trapping, backdrop click & Esc support.
 * 7. Mobile-responsive card transformation for small screens (320px - 640px) with data-labels and min 44px touch targets.
 *
 * STRICT SECURITY: Safe textContent and DOM APIs only (Zero innerHTML with server data).
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
        pending: "Looking for a driver...",
        accepted: "Driver is on the way",
        started: "Trip in progress",
        ongoing: "Trip in progress",
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

    // Day 5 UI Utilities from api.js
    const createSpinner = (typeof window !== "undefined" && window.createSpinner) ? window.createSpinner : (isDark = false) => {
        const s = document.createElement("span");
        s.className = "spinner" + (isDark ? " spinner-dark" : "");
        s.setAttribute("aria-hidden", "true");
        return s;
    };
    const setButtonLoading = (typeof window !== "undefined" && window.setButtonLoading) ? window.setButtonLoading : (btn, loading, text) => {
        if (!btn) return;
        btn.disabled = loading;
        if (loading) {
            btn.setAttribute("aria-busy", "true");
            btn.textContent = text || "Loading...";
        } else {
            btn.removeAttribute("aria-busy");
            btn.textContent = btn.dataset.originalText || "Submit";
        }
    };
    const showContainerLoading = (typeof window !== "undefined" && window.showContainerLoading) ? window.showContainerLoading : (container, text) => {
        if (!container) return;
        container.textContent = text || "Loading...";
    };
    const showContainerError = (typeof window !== "undefined" && window.showContainerError) ? window.showContainerError : (container, msg, onRetry) => {
        if (!container) return;
        container.textContent = msg || "Error occurred.";
        if (onRetry) {
            const btn = document.createElement("button");
            btn.textContent = "Retry";
            btn.onclick = onRetry;
            container.appendChild(btn);
        }
    };
    const showContainerEmpty = (typeof window !== "undefined" && window.showContainerEmpty) ? window.showContainerEmpty : (container, opts) => {
        if (!container) return;
        container.textContent = opts.message || "No items found.";
    };
    const trapModalFocus = (typeof window !== "undefined" && window.trapModalFocus) ? window.trapModalFocus : (modal, onClose) => {
        const handler = (e) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    };

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

    // Modal focus trap cleanup callbacks
    let confirmModalCleanup = null;
    let cancelModalCleanup = null;

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
        // Only log out on a genuine 401 — 500 or network errors keep the cached session.
        try {
            const meRes = await apiRequest(API_CONFIG.ENDPOINTS.me || "/api/me", "GET");

            if (meRes.status === 401) {
                clearSession();
                window.location.replace("login.html?expired=1");
                return;
            }

            if (meRes.ok && meRes.data && meRes.data.user) {
                const verifiedUser = normalizeUser(meRes.data.user);
                if (verifiedUser && verifiedUser.role && verifiedUser.role !== "passenger") {
                    const roleRedirects = {
                        driver: "driver/dashboard.html",
                        admin: "admin/dashboard.html",
                        super_admin: "superadmin/dashboard.html"
                    };
                    window.location.replace(roleRedirects[verifiedUser.role] || "login.html");
                    return;
                }
                if (verifiedUser) {
                    saveSession(verifiedUser, session.token || null);
                    if (greetingEl) {
                        greetingEl.textContent = verifiedUser.name || verifiedUser.full_name || "Passenger";
                    }
                }
            }
            // 500 / network error (status 0): silently keep cached session and load dashboard
        } catch (err) {
            // Network failure — keep cached session, continue loading dashboard
        }

        // Initial fetch of bookings and active status with loading indicators
        await fetchBookings(true);
        await fetchNotifications(true);

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
                fetchNotifications(false);
                const hasActive = currentBookings.some((b) =>
                    ["requested", "pending", "accepted", "started", "ongoing"].includes(b.status)
                );
                if (hasActive) {
                    fetchBookings(false);
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

            // Hide previous messages and reset results container
            if (searchMessage) {
                searchMessage.hidden = true;
                searchMessage.textContent = "";
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

            // Optional distance and duration inputs (Task 8)
            const distInput = document.getElementById("distanceKm");
            const durInput = document.getElementById("durationMin");

            let estimatedDistanceKm = DEFAULT_ESTIMATED_DISTANCE_KM;
            let estimatedDurationMinutes = DEFAULT_ESTIMATED_DURATION_MINUTES;

            if (distInput && distInput.value.trim() !== "") {
                const parsedDist = parseFloat(distInput.value.trim());
                if (isNaN(parsedDist) || parsedDist < 1 || parsedDist > 200) {
                    showMessage(searchMessage, "Distance must be a number between 1 and 200 km.", "error");
                    distInput.focus();
                    return;
                }
                estimatedDistanceKm = Number(parsedDist.toFixed(1));
            }

            if (durInput && durInput.value.trim() !== "") {
                const parsedDur = parseInt(durInput.value.trim(), 10);
                if (isNaN(parsedDur) || parsedDur < 1 || parsedDur > 600) {
                    showMessage(searchMessage, "Estimated time must be between 1 and 600 minutes.", "error");
                    durInput.focus();
                    return;
                }
                estimatedDurationMinutes = parsedDur;
            }

            // Show visible loading states: inside the button AND in the results container
            setButtonLoading(searchBtn, true, "Calculating Fares...");
            if (resultsSection) {
                resultsSection.hidden = false;
            }
            if (cardsGrid) {
                showContainerLoading(cardsGrid, "Calculating fares for available cabs...");
            }

            try {
                const vehicleTypes = ["standard", "sedan", "suv"];
                const farePromises = vehicleTypes.map((type) =>
                    apiRequest(
                        API_CONFIG.ENDPOINTS.fareEstimate || "/api/fare/estimate",
                        "POST",
                        {
                            vehicle_type: type,
                            distance_km: estimatedDistanceKm,
                            duration_minutes: estimatedDurationMinutes
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

                    // Show inline error card with Retry button in cardsGrid
                    if (cardsGrid) {
                        showContainerError(cardsGrid, errorMsg, () => {
                            searchForm.dispatchEvent(new Event("submit"));
                        });
                    }
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
                const errMsg = "An unexpected error occurred while calculating fares. Please retry.";
                showMessage(searchMessage, errMsg, "error");
                if (cardsGrid) {
                    showContainerError(cardsGrid, errMsg, () => {
                        searchForm.dispatchEvent(new Event("submit"));
                    });
                }
            } finally {
                setButtonLoading(searchBtn, false);
            }
        });
    }

    /**
     * Renders cab search result cards safely using document.createElement.
     * @param {Array} rides
     * @param {string} pickup
     * @param {string} destination
     */
    function renderSearchResults(rides, pickup, destination) {
        const resultsSection = document.getElementById("searchResultsSection");
        const cardsGrid = document.getElementById("rideCardsGrid");
        const pickupInput = document.getElementById("pickup");
        const destinationInput = document.getElementById("destination");

        if (!resultsSection || !cardsGrid) {
            return;
        }

        cardsGrid.textContent = "";

        if (rides.length === 0) {
            showContainerEmpty(cardsGrid, {
                icon: "🚕",
                title: "No Cabs Available",
                message: "No cabs are currently available for this route. Try adjusting your destination or check back shortly.",
                ctaText: "Clear Route",
                ctaCallback: () => {
                    if (pickupInput) pickupInput.value = "";
                    if (destinationInput) destinationInput.value = "";
                    if (pickupInput) pickupInput.focus();
                    resultsSection.hidden = true;
                }
            });
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
                const activeBooking = currentBookings.find((b) =>
                    ["requested", "pending", "accepted", "started", "ongoing"].includes(b.status)
                );
                if (activeBooking) {
                    showMessage(
                        document.getElementById("searchMessage"),
                        `You already have an active booking (#${activeBooking.request_id}). Please wait for it to finish or cancel it before booking another ride.`,
                        "error"
                    );
                    return;
                }

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
        confirmBtn.addEventListener("click", handleConfirmBookingSubmission);
    }

    /**
     * Opens the in-page confirmation panel with selected ride details.
     * Traps focus and adds backdrop click handling.
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
        const cancelBtn = document.getElementById("cancelConfirmBtn");

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
            if (typeof confirmModalCleanup === "function") {
                confirmModalCleanup();
            }
            confirmModalCleanup = trapModalFocus(modal, closeBookingConfirmationModal);
        }

        if (confirmBtn) {
            setButtonLoading(confirmBtn, false);
            confirmBtn.focus();
        }
        if (cancelBtn) {
            cancelBtn.disabled = false;
        }
    }

    function closeBookingConfirmationModal() {
        const modal = document.getElementById("confirmBookingModal");
        if (modal) {
            modal.hidden = true;
        }
        if (typeof confirmModalCleanup === "function") {
            confirmModalCleanup();
            confirmModalCleanup = null;
        }
        pendingRide = null;
        isBookingPending = false;

        const confirmBtn = document.getElementById("confirmBookingBtn");
        const cancelBtn = document.getElementById("cancelConfirmBtn");
        if (confirmBtn) {
            setButtonLoading(confirmBtn, false);
        }
        if (cancelBtn) {
            cancelBtn.disabled = false;
        }
    }

    /**
     * Handles the actual booking submission to POST /api/ride-requests.
     * Prevents double clicks and restores buttons in finally block.
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
        setButtonLoading(confirmBtn, true, "Confirming...");
        if (cancelBtn) {
            cancelBtn.disabled = true;
        }

        try {
            const payload = {
                pickup_location: pendingRide.pickup,
                drop_location: pendingRide.destination,
                vehicle_type: pendingRide.vehicle_type
            };

            const endpoint = API_CONFIG.ENDPOINTS.rideRequests || "/api/ride-requests";
            const response = await apiRequest(endpoint, "POST", payload);

            // 401 handled globally by apiRequest
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
            await fetchBookings(false);

            // Smooth scroll to current booking section
            const currentBookingCard = document.getElementById("currentBookingCard");
            if (currentBookingCard) {
                currentBookingCard.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        } catch (err) {
            showMessage(modalMsg, "An error occurred while confirming your booking.", "error");
        } finally {
            isBookingPending = false;
            setButtonLoading(confirmBtn, false);
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
        if (prev && lastActiveBookingStatus && ["requested", "pending", "accepted", "started", "ongoing"].includes(lastActiveBookingStatus)) {
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
     * @param {boolean} [isInitial=false] - Whether this is the first load of the dashboard.
     */
    async function fetchBookings(isInitial = false) {
        const activeContainer = document.getElementById("activeBookingContent");
        const tbody = document.getElementById("tripHistoryBody");

        // Visible loading states on initial dashboard load
        if (isInitial) {
            if (activeContainer) {
                showContainerLoading(activeContainer, "Loading your booking status...");
            }
            if (tbody) {
                tbody.textContent = "";
                const tr = document.createElement("tr");
                const td = document.createElement("td");
                td.colSpan = 7;
                td.className = "empty-state-cell";
                td.setAttribute("aria-busy", "true");
                td.appendChild(createSpinner(true));
                td.appendChild(document.createTextNode(" Loading trip history..."));
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
        }

        try {
            const endpoint = API_CONFIG.ENDPOINTS.myRideRequests || "/api/ride-requests/mine";
            const response = await apiRequest(endpoint, "GET");

            // 401 is handled globally by apiRequest (auto-redirects to login)
            if (!response.ok) {
                const bookingMsg = document.getElementById("bookingMessage");
                const errorText = getErrorMessage(
                    response.data,
                    response.status === 0
                        ? "Cannot reach the server. Please check your connection."
                        : "Unable to retrieve your bookings."
                );

                // If initial load failed or no bookings cached, render an inline error card with Retry button
                if (isInitial || currentBookings.length === 0) {
                    if (activeContainer) {
                        showContainerError(
                            activeContainer,
                            errorText,
                            () => fetchBookings(true)
                        );
                    }
                    if (tbody) {
                        tbody.textContent = "";
                        const tr = document.createElement("tr");
                        const td = document.createElement("td");
                        td.colSpan = 7;
                        td.className = "empty-state-cell";

                        const errorCard = document.createElement("div");
                        errorCard.className = "inline-error-card";
                        errorCard.style.maxWidth = "360px";
                        errorCard.style.margin = "8px auto";

                        const p = document.createElement("p");
                        p.textContent = errorText;
                        errorCard.appendChild(p);

                        const retryBtn = document.createElement("button");
                        retryBtn.type = "button";
                        retryBtn.className = "retry-button";
                        retryBtn.textContent = "Retry Trip History";
                        retryBtn.addEventListener("click", () => fetchBookings(true));
                        errorCard.appendChild(retryBtn);

                        td.appendChild(errorCard);
                        tr.appendChild(td);
                        tbody.appendChild(tr);
                    }
                } else if (bookingMsg && bookingMsg.hidden) {
                    showMessage(bookingMsg, `${errorText} (Retrying automatically...)`, "error");
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
            if (isInitial) {
                if (activeContainer) {
                    showContainerError(
                        activeContainer,
                        "Failed to load bookings. Please check your connection and retry.",
                        () => fetchBookings(true)
                    );
                }
            }
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

        // Find active booking: requested, pending, accepted, started, or ongoing
        const activeBooking = bookings.find((b) =>
            ["requested", "pending", "accepted", "started", "ongoing"].includes(b.status)
        );

        container.textContent = "";

        if (!activeBooking) {
            // No active booking: stop polling and show empty state with CTA to Book a Ride
            stopStatusPolling();
            lastActiveBookingId = null;
            lastActiveBookingStatus = null;

            showContainerEmpty(container, {
                icon: "🚗",
                title: "No Active Booking",
                message: "You don't have any ongoing rides. Search and book a cab above to get started.",
                ctaText: "Book a Ride",
                ctaCallback: () => {
                    const pickupInput = document.getElementById("pickup");
                    if (pickupInput) {
                        pickupInput.focus();
                    }
                    const searchForm = document.getElementById("searchForm");
                    if (searchForm) {
                        searchForm.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                }
            });
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
            waitingBox.textContent = (activeBooking.status === "requested" || activeBooking.status === "pending")
                ? "Waiting for a driver to accept your ride request..."
                : "Driver details will appear shortly...";
            detailsDiv.appendChild(waitingBox);
        }

        // Cancellation Button: only allowed when status is 'requested' — server only cancels requested rides
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
     * Starts polling active bookings and notifications list every ~10s if not already running.
     * Ensures intervals are never duplicated.
     */
    function startStatusPolling() {
        if (!statusPollingTimer) {
            statusPollingTimer = setInterval(() => {
                fetchBookings(false);
                fetchNotifications(false);
            }, 10000);
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
        confirmBtn.addEventListener("click", handleConfirmCancellation);
    }

    /**
     * Opens cancellation modal for the targeted booking and populates its details.
     * Traps focus and adds backdrop click handling.
     * @param {number|string} requestId
     */
    function openCancellationModal(requestId) {
        pendingCancelBookingId = requestId;

        const targetBooking = currentBookings.find((b) => String(b.request_id) === String(requestId));

        const modal = document.getElementById("cancelBookingModal");
        const modalMsg = document.getElementById("cancelModalMessage");
        const confirmBtn = document.getElementById("confirmCancelBtn");
        const abortBtn = document.getElementById("abortCancelBtn");

        const idEl = document.getElementById("cancelBookingId");
        const pickupEl = document.getElementById("cancelPickup");
        const destEl = document.getElementById("cancelDestination");
        const typeEl = document.getElementById("cancelVehicleType");
        const fareEl = document.getElementById("cancelFare");
        const timeEl = document.getElementById("cancelTime");

        if (modalMsg) {
            modalMsg.hidden = true;
            modalMsg.textContent = "";
        }

        if (targetBooking) {
            if (idEl) idEl.textContent = `#${targetBooking.request_id}`;
            if (pickupEl) pickupEl.textContent = targetBooking.pickup_location || "N/A";
            if (destEl) destEl.textContent = targetBooking.drop_location || "N/A";
            if (typeEl) typeEl.textContent = targetBooking.vehicle_type || "Standard";
            const fareAmt = targetBooking.final_fare != null ? targetBooking.final_fare : targetBooking.estimated_fare;
            if (fareEl) fareEl.textContent = formatFare(fareAmt);

            if (timeEl) {
                let timeStr = "N/A";
                try {
                    timeStr = new Date(targetBooking.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short"
                    });
                } catch (e) {
                    timeStr = String(targetBooking.created_at);
                }
                timeEl.textContent = timeStr;
            }
        }

        if (modal) {
            modal.hidden = false;
            if (typeof cancelModalCleanup === "function") {
                cancelModalCleanup();
            }
            cancelModalCleanup = trapModalFocus(modal, closeCancellationModal);
        }

        if (confirmBtn) {
            setButtonLoading(confirmBtn, false);
            confirmBtn.focus();
        }
        if (abortBtn) {
            abortBtn.disabled = false;
        }
    }

    function closeCancellationModal() {
        const modal = document.getElementById("cancelBookingModal");
        if (modal) {
            modal.hidden = true;
        }
        if (typeof cancelModalCleanup === "function") {
            cancelModalCleanup();
            cancelModalCleanup = null;
        }
        pendingCancelBookingId = null;
        isCancellingPending = false;

        const confirmBtn = document.getElementById("confirmCancelBtn");
        const abortBtn = document.getElementById("abortCancelBtn");
        if (confirmBtn) {
            setButtonLoading(confirmBtn, false);
        }
        if (abortBtn) {
            abortBtn.disabled = false;
        }
    }

    /**
     * Sends POST /api/ride-requests/:id/cancel request.
     * Shows loading state and updates the booking list/status without a full page reload.
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
        setButtonLoading(confirmBtn, true, "Cancelling...");
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
                window.location.replace("login.html?expired=1");
                return;
            }

            if (!response.ok) {
                let errorMsg;
                if (response.status === 404) {
                    errorMsg = "This ride can no longer be cancelled; it may already have been accepted or completed.";
                } else if (response.status === 409) {
                    errorMsg = getErrorMessage(response.data, "Cannot cancel this ride in its current status.");
                } else if (response.status === 0) {
                    errorMsg = "Cannot reach the server. Please check your connection.";
                } else {
                    errorMsg = getErrorMessage(response.data, "Failed to cancel booking. Please try again.");
                }
                showMessage(modalMsg, errorMsg, "error");
                await fetchBookings(false);
                return;
            }

            const cancelledId = pendingCancelBookingId;
            closeCancellationModal();

            if (bookingMessage) {
                showMessage(bookingMessage, `Booking #${cancelledId} cancelled successfully.`, "success");
            }

            // Refresh UI in the DOM without a full page reload
            await fetchBookings(false);
        } catch (err) {
            showMessage(modalMsg, "An error occurred while cancelling your booking.", "error");
        } finally {
            isCancellingPending = false;
            setButtonLoading(confirmBtn, false);
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
        const active = bookings.filter((b) => ["requested", "pending", "accepted", "started", "ongoing"].includes(b.status)).length;

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
     * Sets data-label on every td for responsive mobile card stacking without horizontal scroll.
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

            const emptyWrapper = document.createElement("div");
            emptyWrapper.className = "empty-state";
            emptyWrapper.style.padding = "16px";

            const iconSpan = document.createElement("span");
            iconSpan.className = "empty-state-icon";
            iconSpan.textContent = "🗺️";
            emptyWrapper.appendChild(iconSpan);

            const titleEl = document.createElement("div");
            titleEl.className = "empty-state-title";
            titleEl.textContent = "No Past Trips";
            emptyWrapper.appendChild(titleEl);

            const p = document.createElement("p");
            p.textContent = "You don't have any past rides yet. Book your first ride to get moving!";
            emptyWrapper.appendChild(p);

            const ctaBtn = document.createElement("button");
            ctaBtn.type = "button";
            ctaBtn.className = "button secondary";
            ctaBtn.textContent = "Book Your First Ride";
            ctaBtn.addEventListener("click", () => {
                const pickupInput = document.getElementById("pickup");
                if (pickupInput) {
                    pickupInput.focus();
                }
                const searchForm = document.getElementById("searchForm");
                if (searchForm) {
                    searchForm.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            });
            emptyWrapper.appendChild(ctaBtn);

            td.appendChild(emptyWrapper);
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
            tdId.setAttribute("data-label", "Trip ID");
            tdId.textContent = `#${trip.request_id}`;
            tr.appendChild(tdId);

            // Date (en-IN)
            const tdDate = document.createElement("td");
            tdDate.setAttribute("data-label", "Date");
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
            tdRoute.setAttribute("data-label", "Route");
            tdRoute.textContent = `${trip.pickup_location || "N/A"} → ${trip.drop_location || "N/A"}`;
            tr.appendChild(tdRoute);

            // Vehicle
            const tdVehicle = document.createElement("td");
            tdVehicle.setAttribute("data-label", "Vehicle");
            tdVehicle.style.textTransform = "capitalize";
            tdVehicle.textContent = trip.vehicle_type || "Standard";
            tr.appendChild(tdVehicle);

            // Fare
            const tdFare = document.createElement("td");
            tdFare.setAttribute("data-label", "Fare");
            const fareAmount = trip.final_fare != null ? trip.final_fare : trip.estimated_fare;
            tdFare.textContent = formatFare(fareAmount);
            tr.appendChild(tdFare);

            // Status Badge
            const tdStatus = document.createElement("td");
            tdStatus.setAttribute("data-label", "Status");
            const badge = document.createElement("span");
            badge.className = `badge badge-status-${trip.status}`;
            badge.textContent = (trip.status || "UNKNOWN").toUpperCase();
            tdStatus.appendChild(badge);
            tr.appendChild(tdStatus);

            // Driver Name
            const tdDriver = document.createElement("td");
            tdDriver.setAttribute("data-label", "Driver");
            tdDriver.textContent = trip.driver && trip.driver.full_name ? trip.driver.full_name : "—";
            tr.appendChild(tdDriver);

            tbody.appendChild(tr);
        });
    }

    /* ==========================================================================
       6. Notifications Panel (Day 6 - Task 7)
       ========================================================================== */

    /**
     * Fetches notifications for the logged-in passenger.
     * @param {boolean} [isInitial=false]
     */
    async function fetchNotifications(isInitial = false) {
        const container = document.getElementById("notificationsList");
        const badge = document.getElementById("unreadNotificationsBadge");
        if (!container) return;

        if (isInitial) {
            showContainerLoading(container, "Loading notifications...");
        }

        try {
            const endpoint = (API_CONFIG.ENDPOINTS && API_CONFIG.ENDPOINTS.notifications) || "/api/notifications";
            const response = await apiRequest(endpoint, "GET");

            if (!response.ok) {
                if (isInitial) {
                    showContainerError(
                        container,
                        getErrorMessage(response.data, "Failed to load notifications."),
                        () => fetchNotifications(true)
                    );
                }
                return;
            }

            const notifications = (response.data && Array.isArray(response.data.notifications))
                ? response.data.notifications
                : [];

            renderNotifications(notifications);
        } catch (err) {
            if (isInitial) {
                showContainerError(
                    container,
                    "Failed to load notifications. Please retry.",
                    () => fetchNotifications(true)
                );
            }
        }
    }

    /**
     * Renders notifications list cleanly using safe DOM APIs.
     * @param {Array} list
     */
    function renderNotifications(list) {
        const container = document.getElementById("notificationsList");
        const badge = document.getElementById("unreadNotificationsBadge");
        if (!container) return;

        container.textContent = "";

        const unreadCount = list.filter((n) => !n.is_read).length;
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = String(unreadCount);
                badge.hidden = false;
            } else {
                badge.hidden = true;
            }
        }

        if (list.length === 0) {
            showContainerEmpty(container, {
                icon: "🔔",
                title: "",
                message: "No notifications yet."
            });
            return;
        }

        const listEl = document.createElement("div");
        listEl.className = "notifications-list";

        list.forEach((item) => {
            const itemEl = document.createElement("div");
            itemEl.className = "notification-item" + (!item.is_read ? " unread" : "");

            const contentDiv = document.createElement("div");
            contentDiv.className = "notification-content";

            const msgP = document.createElement("p");
            msgP.className = "notification-message";
            msgP.textContent = item.message || "Notification";
            contentDiv.appendChild(msgP);

            const metaSpan = document.createElement("span");
            metaSpan.className = "notification-meta";
            let timeStr = "";
            if (item.created_at) {
                try {
                    timeStr = new Date(item.created_at).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short"
                    });
                } catch (e) {
                    timeStr = String(item.created_at);
                }
            }
            metaSpan.textContent = timeStr ? timeStr : "";
            contentDiv.appendChild(metaSpan);

            const statusBadge = document.createElement("span");
            statusBadge.className = "notification-status-badge " + (!item.is_read ? "unread" : "read");
            statusBadge.textContent = !item.is_read ? "New" : "Read";

            itemEl.appendChild(contentDiv);
            itemEl.appendChild(statusBadge);

            // Clicking an unread item marks it as read via PATCH
            if (!item.is_read) {
                itemEl.title = "Click to mark as read";
                itemEl.addEventListener("click", async () => {
                    const readUrl = typeof API_CONFIG.getMarkNotificationReadUrl === "function"
                        ? API_CONFIG.getMarkNotificationReadUrl(item.notification_id)
                        : `/api/notifications/${encodeURIComponent(item.notification_id)}/read`;
                    try {
                        const patchRes = await apiRequest(readUrl, "PATCH");
                        if (patchRes.ok) {
                            item.is_read = 1;
                            renderNotifications(list);
                        }
                    } catch (e) {
                        // ignore
                    }
                });
            }

            listEl.appendChild(itemEl);
        });

        container.appendChild(listEl);
    }

    // Expose for debugging if needed
    if (typeof window !== "undefined") {
        window.CabGoPassenger = {
            fetchBookings: fetchBookings,
            fetchNotifications: fetchNotifications,
            openBookingConfirmationModal: openBookingConfirmationModal,
            openCancellationModal: openCancellationModal,
            normalizeBooking: normalizeBooking
        };
    }
})();