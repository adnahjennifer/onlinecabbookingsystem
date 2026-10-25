/**
 * CabGo - Online Cab Booking System
 * Passenger Dashboard Controller (Day 3 - Member 1)
 *
 * Implements:
 * 1. Cab search with route validation & loading states.
 * 2. Fare calculation and display in Indian Rupees (₹).
 * 3. In-page booking confirmation modal with double-booking prevention.
 * 4. Dynamic active booking status card with live driver/vehicle details.
 * 5. Automatic status polling (~10s) with proper cleanup.
 * 6. Booking cancellation controls for requested/accepted rides.
 * 7. Live computed statistics and recent trip history table with empty states.
 *
 * STRICT SECURITY: Zero innerHTML with server data (XSS prevention).
 */

"use strict";

(function () {
    // Resolve helper references safely from window
    const API_CONFIG = (typeof window !== "undefined" && window.API_CONFIG) ? window.API_CONFIG : (typeof API_CONFIG !== "undefined" ? API_CONFIG : {});
    const getSession = (typeof window !== "undefined" && window.getSession) ? window.getSession : () => null;
    const normalizeUser = (typeof window !== "undefined" && window.normalizeUser) ? window.normalizeUser : (u) => u;
    const formatFare = (typeof window !== "undefined" && window.formatFare) ? window.formatFare : (n) => `₹${Number(n).toFixed(2)}`;
    const getErrorMessage = (typeof window !== "undefined" && window.getErrorMessage) ? window.getErrorMessage : (d, fb) => (d && (d.message || (d.error && d.error.message))) || fb;
    const apiRequest = (typeof window !== "undefined" && window.apiRequest) ? window.apiRequest : () => Promise.resolve({ ok: false, status: 0 });
    const showMessage = (typeof window !== "undefined" && window.showMessage) ? window.showMessage : () => {};
    const clearSession = (typeof window !== "undefined" && window.clearSession) ? window.clearSession : () => {};

    // Polling interval reference for active bookings
    let statusPollingTimer = null;

    // Currently selected ride for confirmation modal
    let pendingRide = null;

    // Booking targeted for cancellation
    let pendingCancelBookingId = null;

    // Cached bookings array
    let currentBookings = [];

    // Is booking submission in flight
    let isBookingPending = false;

    // Is cancellation in flight
    let isCancellingPending = false;

    /* ==========================================================================
       Initialization & Session Guard
       ========================================================================== */

    document.addEventListener("DOMContentLoaded", function () {
        const session = getSession();

        // Ensure user is authenticated and has passenger role
        if (!session || !session.user) {
            window.location.replace("login.html");
            return;
        }

        const user = normalizeUser(session.user);
        if (user.role && user.role !== "passenger") {
            const redirects = {
                driver: "driver/dashboard.html",
                admin: "admin/dashboard.html",
                super_admin: "superadmin/dashboard.html"
            };
            window.location.replace(redirects[user.role] || "login.html");
            return;
        }

        // Display passenger name in greeting
        const greetingEl = document.getElementById("passengerName");
        if (greetingEl) {
            greetingEl.textContent = user.name || user.full_name || "Passenger";
        }

        // Initialize event handlers
        initSearchForm();
        initBookingConfirmationModal();
        initCancellationModal();

        // Initial fetch of bookings and status
        fetchBookings();

        // Clear polling timer on page unload
        window.addEventListener("beforeunload", stopStatusPolling);
    });

    /* ==========================================================================
       1. Cab Search Form & Results Rendering
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

            // Route validation: both required, must differ
            if (!pickup || !destination) {
                showMessage(searchMessage, "Please enter both pickup and destination locations.", "error");
                if (!pickup && pickupInput) {
                    pickupInput.focus();
                } else if (!destination && destinationInput) {
                    destinationInput.focus();
                }
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
            searchBtn.textContent = "Searching Cabs...";

            try {
                const response = await apiRequest(
                    API_CONFIG.ENDPOINTS.searchRides,
                    "POST",
                    {
                        pickup_location: pickup,
                        drop_location: destination
                    }
                );

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
                            : "Failed to find available cabs. Please try again."
                    );
                    showMessage(searchMessage, errorMsg, "error");
                    return;
                }

                const rides = response.data && Array.isArray(response.data.rides)
                    ? response.data.rides
                    : [];

                renderSearchResults(rides, pickup, destination);
            } catch (err) {
                showMessage(searchMessage, "An unexpected error occurred while searching. Please try again.", "error");
            } finally {
                searchBtn.disabled = false;
                searchBtn.removeAttribute("aria-busy");
                searchBtn.textContent = originalBtnText;
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
        const searchMessage = document.getElementById("searchMessage");

        if (!resultsSection || !cardsGrid) {
            return;
        }

        cardsGrid.textContent = "";

        if (rides.length === 0) {
            const emptyDiv = document.createElement("div");
            emptyDiv.className = "empty-state";

            const p = document.createElement("p");
            p.textContent = "No cabs are currently available for this route. Please try again in a few minutes.";
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

            if (ride.available_drivers !== undefined) {
                const pDrivers = document.createElement("p");
                pDrivers.style.margin = "2px 0 0";
                const count = parseInt(ride.available_drivers, 10) || 0;
                pDrivers.textContent = `${count} cab${count === 1 ? "" : "s"} available`;
                metaEl.appendChild(pDrivers);
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

        // Close on escape key
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
                : "Calculating...";
        }
        if (durationEl) {
            durationEl.textContent = rideDetails.estimated_minutes
                ? `${rideDetails.estimated_minutes} mins`
                : "Calculating...";
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
     * Handles the actual booking submission to POST /api/bookings.
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
            const payload = {
                pickup_location: pendingRide.pickup,
                drop_location: pendingRide.destination,
                vehicle_type: pendingRide.vehicle_type,
                estimated_fare: pendingRide.estimated_fare
            };

            const response = await apiRequest(API_CONFIG.ENDPOINTS.bookings, "POST", payload);

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

            // Booking successfully created
            const newBooking = response.data && response.data.booking ? response.data.booking : null;
            const bookingId = newBooking ? newBooking.request_id : "";

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

            // Show success message on the dashboard
            if (bookingMessage) {
                const successText = bookingId
                    ? `Booking #${bookingId} confirmed successfully! Looking for a nearby driver...`
                    : "Booking confirmed successfully!";
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
     * Fetches all passenger bookings from GET /api/bookings and updates UI.
     */
    async function fetchBookings() {
        try {
            const response = await apiRequest(API_CONFIG.ENDPOINTS.bookings, "GET");

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

            const bookings = response.data && Array.isArray(response.data.bookings)
                ? response.data.bookings
                : [];

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

        // An active booking exists: ensure polling is active
        startStatusPolling();

        const detailsDiv = document.createElement("div");
        detailsDiv.className = "active-booking-details";

        // Row 1: Booking ID & Status badge
        const statusBadge = document.createElement("span");
        statusBadge.className = `badge badge-status-${activeBooking.status}`;
        statusBadge.textContent = activeBooking.status.toUpperCase();
        const rowId = createDetailRow("Booking ID", `#${activeBooking.request_id}`, statusBadge);
        detailsDiv.appendChild(rowId);

        // Row 2: Route (Pickup & Drop)
        const rowPickup = createDetailRow("Pickup Location", activeBooking.pickup_location);
        const rowDrop = createDetailRow("Destination", activeBooking.drop_location);
        detailsDiv.appendChild(rowPickup);
        detailsDiv.appendChild(rowDrop);

        // Row 3: Vehicle Type & Fare
        const rowVehicle = createDetailRow(
            "Vehicle Type",
            activeBooking.vehicle_type
                ? activeBooking.vehicle_type.charAt(0).toUpperCase() + activeBooking.vehicle_type.slice(1)
                : "Standard"
        );
        const rowFare = createDetailRow(
            "Estimated Fare",
            formatFare(activeBooking.final_fare != null ? activeBooking.final_fare : activeBooking.estimated_fare)
        );
        detailsDiv.appendChild(rowVehicle);
        detailsDiv.appendChild(rowFare);

        // Driver & Vehicle details section
        if (activeBooking.driver && activeBooking.vehicle) {
            const driverBox = document.createElement("div");
            driverBox.className = "driver-info-box";

            const boxTitle = document.createElement("h4");
            boxTitle.textContent = "Assigned Driver & Vehicle";

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

            const pVehicle = document.createElement("p");
            const strongVehicle = document.createElement("strong");
            strongVehicle.textContent = "Vehicle: ";
            pVehicle.appendChild(strongVehicle);
            const vehModel = activeBooking.vehicle.model || "Cab";
            const vehPlate = activeBooking.vehicle.registration_number ? ` (${activeBooking.vehicle.registration_number})` : "";
            pVehicle.appendChild(document.createTextNode(`${vehModel}${vehPlate}`));

            driverBox.appendChild(boxTitle);
            driverBox.appendChild(pDriver);
            driverBox.appendChild(pVehicle);
            detailsDiv.appendChild(driverBox);
        } else {
            const waitingBox = document.createElement("div");
            waitingBox.className = "driver-waiting-box";
            waitingBox.textContent = "Waiting for a driver to accept your ride request...";
            detailsDiv.appendChild(waitingBox);
        }

        // Cancellation Button: only visible when status is 'requested' or 'accepted'
        if (["requested", "accepted"].includes(activeBooking.status)) {
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
     */
    function startStatusPolling() {
        if (!statusPollingTimer) {
            statusPollingTimer = setInterval(fetchBookings, 10000);
        }
    }

    /**
     * Stops the active polling timer.
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
     * Sends POST /api/bookings/:request_id/cancel request.
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
                : API_CONFIG.ENDPOINTS.cancelBooking.replace(":request_id", encodeURIComponent(pendingCancelBookingId));

            const response = await apiRequest(cancelUrl, "POST");

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
                        : "Failed to cancel booking. It may have already started or completed."
                );
                showMessage(modalMsg, errorMsg, "error");
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
     * Renders recent trip history into the table with empty state handling.
     * @param {Array} bookings
     */
    function updateTripHistoryTable(bookings) {
        const tbody = document.getElementById("tripHistoryBody");
        if (!tbody) {
            return;
        }

        tbody.textContent = "";

        if (bookings.length === 0) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 5;
            td.className = "empty-state-cell";
            td.textContent = "No booking history found. Your completed and past rides will appear here.";
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        // Limit to 10 most recent bookings
        const recent = bookings.slice(0, 10);

        recent.forEach((trip) => {
            const tr = document.createElement("tr");

            // Trip / Request ID
            const tdId = document.createElement("td");
            tdId.textContent = `#${trip.request_id}`;
            tr.appendChild(tdId);

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

            tbody.appendChild(tr);
        });
    }

    // Expose for debugging if needed
    if (typeof window !== "undefined") {
        window.CabGoPassenger = {
            fetchBookings: fetchBookings,
            openBookingConfirmationModal: openBookingConfirmationModal,
            openCancellationModal: openCancellationModal
        };
    }
})();
