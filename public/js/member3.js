/**
 * CabGo - Online Cab Booking System
 * Driver, admin, and super admin controller
 * Ride actions, trip lifecycle, vehicle management, and earnings
 *
 * Implements:
 * 1. Driver session guard & role validation.
 * 2. Driver availability toggle (online/offline) via API with fallback.
 * 3. Incoming ride requests list with passenger details & route info.
 * 4. Driver ride actions: Accept & Reject with duplicate action prevention.
 * 5. Complete Trip Lifecycle: Accept -> Start Trip -> Complete Trip with Final Fare.
 * 6. Vehicle Management: View driver fleet, Add vehicle with validation, Edit details.
 * 7. Driver Earnings: Real-time aggregated gross earnings, trip counts, and itemized statement.
 * 8. Clear separation between Live API and Demo/Sample Data modes.
 */

"use strict";

(function () {
  // Resolve dependencies safely from window
  const API_CONFIG =
    typeof window !== "undefined" && window.API_CONFIG ? window.API_CONFIG : {};
  const getSession =
    typeof window !== "undefined" && window.getSession
      ? window.getSession
      : () => null;
  const saveSession =
    typeof window !== "undefined" && window.saveSession
      ? window.saveSession
      : () => {};
  const clearSession =
    typeof window !== "undefined" && window.clearSession
      ? window.clearSession
      : () => {};
  const apiRequest =
    typeof window !== "undefined" && window.apiRequest
      ? window.apiRequest
      : async () => ({ ok: false, status: 0, data: { message: "API client not found" } });
  const formatFare =
    typeof window !== "undefined" && window.formatFare
      ? window.formatFare
      : (amount) => `₹${Number(amount || 0).toFixed(2)}`;

  // Application State
  const state = {
    driver: {
      id: 102,
      name: "Arjun S.",
      availability: "available", // "available" | "offline" | "on_trip"
      rating: 4.8
    },
    requests: [],
    vehicles: [],
    earnings: {
      total_earnings: 0,
      completed_trips_count: 0,
      average_fare: 0,
      trips: []
    },
    pendingCompleteTrip: null,
    isSubmitting: false
  };

  /* ==========================================================================
     Helper Utilities
     ========================================================================== */

  function showMessageEl(element, text, kind = "") {
    if (!element) return;
    element.textContent = text;
    element.className = ("message " + (kind || "")).trim();
    element.hidden = false;
  }

  function updateDataModeBadge() {
    const badges = document.querySelectorAll("#dataModeBadge, .mode-badge");
    badges.forEach((b) => {
      if (b.id === "dataModeBadge" || b.classList.contains("mode-badge")) {
        b.textContent = "Live API Connected";
        b.className = "mode-badge mode-live";
        b.title = "Connected directly to Node.js / MySQL backend";
      }
    });
  }

  function syncDriverSession() {
    const session = getSession();
    if (session && session.user) {
      state.driver.id = session.user.driver_id || session.user.user_id || 102;
      state.driver.name =
        session.user.full_name || session.user.name || "Arjun S.";
    }

    const greeting = document.getElementById("driverGreeting");
    if (greeting) {
      greeting.textContent = `Good day, ${state.driver.name}`;
    }

    const userChips = document.querySelectorAll("#driverUserChip, .user-chip");
    userChips.forEach((chip) => {
      chip.textContent = `${state.driver.name} · DRV-${state.driver.id}`;
    });

    const logoutBtns = document.querySelectorAll(
      "#driverLogoutBtn, [data-action='logout']"
    );
    logoutBtns.forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await apiRequest(API_CONFIG.ENDPOINTS.logout || "/api/logout", "POST");
        } finally {
          clearSession();
          window.location.href = "login.html";
        }
      });
    });
  }

  /* ==========================================================================
     Day 2: Driver Login Authentication Handler
     ========================================================================== */

  function initDriverLogin() {
    const loginForm = document.getElementById("driverLoginForm");
    if (!loginForm) return;

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const emailInput = document.getElementById("email");
      const passwordInput = document.getElementById("password");
      const loginMessage = document.getElementById("loginMessage");
      const submitBtn = document.getElementById("driverLoginSubmitBtn") ||
        loginForm.querySelector('button[type="submit"]');

      if (!emailInput || !passwordInput || !loginMessage) return;

      const email = emailInput.value.trim().toLowerCase();
      const password = passwordInput.value;

      if (!email || !password) {
        showMessageEl(
          loginMessage,
          "Please enter both your email and password.",
          "error"
        );
        return;
      }

      if (!emailInput.checkValidity()) {
        showMessageEl(
          loginMessage,
          "Please enter a valid email address.",
          "error"
        );
        emailInput.focus();
        return;
      }

      if (password.length < 6) {
        showMessageEl(
          loginMessage,
          "Password must contain at least 6 characters.",
          "error"
        );
        passwordInput.focus();
        return;
      }

      const originalText = submitBtn ? submitBtn.textContent : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-busy", "true");
        submitBtn.textContent = "Authenticating...";
      }

      try {
        const response = await apiRequest(
          API_CONFIG.ENDPOINTS ? API_CONFIG.ENDPOINTS.login : "/api/login",
          "POST",
          { email, password }
        );

        if (response.ok && response.data) {
          const sessionResponse = await apiRequest("/api/me", "GET");
          if (
            !sessionResponse.ok ||
            !sessionResponse.data ||
            !sessionResponse.data.user
          ) {
            clearSession();
            showMessageEl(
              loginMessage,
              "Your session could not be verified. Please try again.",
              "error"
            );
            return;
          }

          const user = sessionResponse.data.user;
          if (user.role !== "driver") {
            clearSession();
            showMessageEl(
              loginMessage,
              "This account is not authorized for the driver portal.",
              "error"
            );
            setTimeout(() => {
              window.location.replace("../login.html?forbidden=1");
            }, 600);
            return;
          }

          saveSession(user, response.data.token || null);
          showMessageEl(
            loginMessage,
            "Login successful! Opening driver dashboard...",
            "success"
          );

          setTimeout(() => {
            window.location.href = "dashboard.html";
          }, 600);
        } else {
          const errMsg =
            (response.data &&
              (response.data.message ||
                (response.data.error && response.data.error.message))) ||
            "Invalid email or password.";
          showMessageEl(loginMessage, errMsg, "error");
        }
      } catch (err) {
        showMessageEl(
          loginMessage,
          "Network failure while authenticating. Check your connection.",
          "error"
        );
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.removeAttribute("aria-busy");
          submitBtn.textContent = originalText;
        }
      }
    });
  }

  /* ==========================================================================
     Driver availability management
     ========================================================================== */

  async function updateAvailabilityUI(avail) {
    state.driver.availability = avail;
    const isOnline = avail === "available";
    const isOnTrip = avail === "on_trip";

    const availabilityBtn = document.getElementById("availabilityBtn");
    const availabilityState = document.getElementById("availabilityState");

    if (availabilityState) {
      if (isOnTrip) {
        availabilityState.textContent = "On Trip (Busy)";
        availabilityState.className = "pill pill-info";
      } else if (isOnline) {
        availabilityState.textContent = "Online";
        availabilityState.className = "pill pill-success";
      } else {
        availabilityState.textContent = "Offline";
        availabilityState.className = "pill pill-warning";
      }
    }

    if (availabilityBtn) {
      availabilityBtn.textContent = isOnline ? "Go offline" : "Go online";
      availabilityBtn.classList.toggle("button-success", isOnline);
      availabilityBtn.classList.toggle("button-quiet", !isOnline);
      availabilityBtn.disabled = isOnTrip;
      if (isOnTrip) {
        availabilityBtn.title = "Cannot change availability during an active ride.";
      } else {
        availabilityBtn.removeAttribute("title");
      }
    }

    // When offline, disable pending request response buttons
    const pendingButtons = document.querySelectorAll(
      'tr[data-status="requested"] button, tr[data-status="pending"] button'
    );
    pendingButtons.forEach((btn) => {
      btn.disabled = !isOnline && !isOnTrip;
    });
  }

  function initAvailabilityControls() {
    const availabilityBtn = document.getElementById("availabilityBtn");
    if (!availabilityBtn) return;

    availabilityBtn.addEventListener("click", async () => {
      const nextStatus =
        state.driver.availability === "available" ? "offline" : "available";

      const originalText = availabilityBtn.textContent;
      availabilityBtn.disabled = true;
      availabilityBtn.textContent = "Updating...";

      try {
        const endpoint = API_CONFIG.ENDPOINTS
          ? API_CONFIG.ENDPOINTS.driverAvailability
          : "/api/driver/availability";
        const response = await apiRequest(endpoint, "PATCH", {
          availability_status: nextStatus
        });

        if (response.ok) {
          await updateAvailabilityUI(nextStatus);
          const msg = document.getElementById("driverMessage");
          if (msg) {
            showMessageEl(
              msg,
              `You are now ${nextStatus}. ${
                nextStatus === "available"
                  ? "You can accept incoming ride requests."
                  : "You are hidden from new ride dispatches."
              }`,
              "success"
            );
          }
        } else {
          const msg = document.getElementById("driverMessage");
          if (msg) {
            showMessageEl(
              msg,
              (response.data && response.data.message) ||
                "Failed to update availability status on server.",
              "error"
            );
          }
        }
      } catch (e) {
        console.error("Availability error:", e);
      } finally {
        availabilityBtn.disabled = false;
        availabilityBtn.textContent =
          state.driver.availability === "available"
            ? "Go offline"
            : "Go online";
      }
    });
  }

  /* ==========================================================================
     Ride requests and trip lifecycle controller
     ========================================================================== */

  async function fetchDriverRequests() {
    const tbody =
      document.getElementById("requestsBody") ||
      document.getElementById("overviewRequestsBody");
    const driverMessage = document.getElementById("driverMessage");

    if (!tbody) return;

    const endpoint = API_CONFIG.ENDPOINTS
      ? API_CONFIG.ENDPOINTS.driverRequests
      : "/api/driver/requests";

    try {
      const response = await apiRequest(endpoint, "GET");

      if (response.ok && response.data && Array.isArray(response.data.requests)) {
        state.requests = response.data.requests;
        if (response.data.driver) {
          const d = response.data.driver;
          if (d.availability_status) {
            updateAvailabilityUI(d.availability_status);
          }
          // Render rating and verification status on dashboard stat card
          const ratingEl = document.getElementById("statDriverRating");
          if (ratingEl) {
            const ratingVal = d.rating != null ? parseFloat(d.rating).toFixed(1) : "-";
            ratingEl.innerHTML = `${ratingVal} <span class="star">★</span>`;
            const ratingCard = ratingEl.closest(".stat-card");
            const ratingSmall = ratingCard ? ratingCard.querySelector("small") : null;
            if (ratingSmall) {
              const vs = d.verification_status
                ? capitalize(d.verification_status)
                : "Unknown";
              ratingSmall.textContent = `Verification: ${vs}`;
            }
          }
        }
        renderRequestsTable(state.requests, tbody);
        updateRequestCounts();
      } else {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">Unable to load requests</div>
          <div class="empty-state-desc">${
            (response.data && response.data.message) ||
            "Please check backend API connectivity."
          }</div>
        </div></td></tr>`;
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Network error</div>
        <div class="empty-state-desc">Failed to communicate with driver API.</div>
      </div></td></tr>`;
    }
  }

  function renderRequestsTable(requests, tbody) {
    if (!tbody) return;

    if (!requests || requests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
        <div class="empty-state-icon">🚖</div>
        <div class="empty-state-title">No ride requests found</div>
        <div class="empty-state-desc">New passenger bookings will appear here in real-time.</div>
      </div></td></tr>`;
      return;
    }

    const isOnline = state.driver.availability === "available";
    const isOnTrip = state.driver.availability === "on_trip";

    const isOverview = tbody.id === "overviewRequestsBody";

    let html = "";
    requests.forEach((req) => {
      const reqId = req.request_id || req.id;
      const tripId = req.trip_id || reqId;
      const passengerName = req.passenger_name || req.passenger || "Passenger";
      const pickup = req.pickup_location || req.pickup || "-";
      const drop = req.drop_location || req.destination || "-";
      const vehicleType = req.vehicle_type || "standard";
      const fare = req.final_fare || req.estimated_fare || 0;
      const status = (req.status || "requested").toLowerCase();

      let statusBadge = "";
      let actionControl = "";

      switch (status) {
        case "requested":
        case "pending":
          statusBadge = '<span class="pill pill-warning status-pill">Requested</span>';
          actionControl = `
            <div class="actions">
              <button class="button button-small button-success" data-action="accept" data-request-id="${reqId}" type="button" ${
                !isOnline && !isOnTrip ? "disabled title='Go online to accept'" : ""
              }>Accept</button>
              <button class="button button-small button-quiet" data-action="reject" data-request-id="${reqId}" type="button" ${
                !isOnline && !isOnTrip ? "disabled" : ""
              }>Reject</button>
            </div>
          `;
          break;

        case "accepted":
          statusBadge = '<span class="pill pill-info status-pill">Accepted</span>';
          actionControl = `
            <div class="actions">
              <button class="button button-small button-info" data-action="start-trip" data-request-id="${reqId}" data-trip-id="${tripId}" type="button">Start Trip</button>
            </div>
          `;
          break;

        case "started":
          statusBadge = '<span class="pill pill-purple status-pill">In Transit</span>';
          actionControl = `
            <div class="actions">
              <button class="button button-small button-success" data-action="complete-trip" data-request-id="${reqId}" data-trip-id="${tripId}" data-estimate="${fare}" data-pickup="${pickup}" data-drop="${drop}" type="button">Complete Trip</button>
            </div>
          `;
          break;

        case "completed":
          statusBadge = '<span class="pill pill-success status-pill">Completed</span>';
          actionControl = '<span style="color:#166534;font-size:11px;font-weight:700;">✓ Finished</span>';
          break;

        case "rejected":
          statusBadge = '<span class="pill pill-danger status-pill">Rejected</span>';
          actionControl = '<span style="color:#991b1b;font-size:11px;">Rejected</span>';
          break;

        case "cancelled":
          statusBadge = '<span class="pill pill-danger status-pill">Cancelled</span>';
          actionControl = '<span style="color:#991b1b;font-size:11px;">Cancelled</span>';
          break;

        default:
          statusBadge = `<span class="pill status-pill">${status}</span>`;
          actionControl = "-";
      }

      if (isOverview) {
        html += `
          <tr data-request-id="${reqId}" data-status="${status}" class="${status === 'started' ? 'trip-highlight' : ''}">
            <td><strong>#RB-${reqId}</strong></td>
            <td>${escapeHtml(passengerName)}</td>
            <td>${escapeHtml(pickup)}</td>
            <td>${escapeHtml(drop)}</td>
            <td><strong>${formatFare(fare)}</strong></td>
            <td>${statusBadge}</td>
            <td>${actionControl}</td>
          </tr>
        `;
      } else {
        html += `
          <tr data-request-id="${reqId}" data-status="${status}" class="${status === 'started' ? 'trip-highlight' : ''}">
            <td><strong>#RB-${reqId}</strong></td>
            <td>${escapeHtml(passengerName)}</td>
            <td>${escapeHtml(pickup)}</td>
            <td>${escapeHtml(drop)}</td>
            <td style="text-transform:capitalize;">${escapeHtml(vehicleType)}</td>
            <td><strong>${formatFare(fare)}</strong></td>
            <td>${statusBadge}</td>
            <td>${actionControl}</td>
          </tr>
        `;
      }
    });

    tbody.innerHTML = html;
  }

  function updateRequestCounts() {
    const pendingEl = document.getElementById("pendingCount");
    const acceptedEl = document.getElementById("acceptedCount");
    const completedEl = document.getElementById("completedCount");

    const pending = state.requests.filter(
      (r) => r.status === "requested" || r.status === "pending"
    ).length;
    const active = state.requests.filter(
      (r) => r.status === "accepted" || r.status === "started"
    ).length;
    const completed = state.requests.filter(
      (r) => r.status === "completed"
    ).length;

    if (pendingEl) pendingEl.textContent = pending;
    if (acceptedEl) acceptedEl.textContent = active;
    if (completedEl) completedEl.textContent = completed;

    // Overview stats
    const ovCompleted = document.getElementById("statCompletedTrips");
    if (ovCompleted) {
      ovCompleted.textContent = completed;
    }
  }

  function initRideRequestActions() {
    const containers = [
      document.getElementById("requestsBody"),
      document.getElementById("overviewRequestsBody")
    ];

    containers.forEach((container) => {
      if (!container) return;

      container.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const button = target.closest("button[data-action]");
        if (!button) return;

        const action = button.dataset.action;
        const reqId = button.dataset.requestId;
        const tripId = button.dataset.tripId || reqId;
        const driverMessage = document.getElementById("driverMessage");

        if (!action || !reqId) return;

        // Prevent double submit
        if (button.disabled || button.getAttribute("aria-busy") === "true") return;

        // 1. ACCEPT ACTION
        if (action === "accept") {
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
          const originalText = button.textContent;
          button.textContent = "Accepting...";

          try {
            const url = API_CONFIG.getDriverAcceptUrl
              ? API_CONFIG.getDriverAcceptUrl(reqId)
              : `/api/driver/requests/${reqId}/accept`;

            const response = await apiRequest(url, "POST");

            if (response.ok) {
              const req = state.requests.find(
                (r) => String(r.request_id || r.id) === String(reqId)
              );
              if (req) {
                req.status = "accepted";
                req.trip_id =
                  (response.data && response.data.trip && response.data.trip.trip_id) ||
                  reqId;
              }
              await updateAvailabilityUI("on_trip");
              renderRequestsTable(state.requests, container);
              updateRequestCounts();
              showMessageEl(
                driverMessage,
                `Request #RB-${reqId} accepted successfully! You can now start the trip when you reach the passenger.`,
                "success"
              );
            } else {
              const errMsg =
                (response.data &&
                  (response.data.message ||
                    (response.data.error && response.data.error.message))) ||
                "Failed to accept ride request.";
              showMessageEl(driverMessage, errMsg, "error");
              button.disabled = false;
              button.removeAttribute("aria-busy");
              button.textContent = originalText;
            }
          } catch (e) {
            showMessageEl(driverMessage, "Network error during accept action.", "error");
            button.disabled = false;
            button.removeAttribute("aria-busy");
            button.textContent = originalText;
          }
        }

        // 2. REJECT ACTION
        if (action === "reject") {
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
          const originalText = button.textContent;
          button.textContent = "Rejecting...";

          try {
            const url = API_CONFIG.getDriverRejectUrl
              ? API_CONFIG.getDriverRejectUrl(reqId)
              : `/api/driver/requests/${reqId}/reject`;

            const response = await apiRequest(url, "POST");

            if (response.ok) {
              const req = state.requests.find(
                (r) => String(r.request_id || r.id) === String(reqId)
              );
              if (req) req.status = "rejected";
              renderRequestsTable(state.requests, container);
              updateRequestCounts();
              showMessageEl(driverMessage, `Request #RB-${reqId} was rejected.`, "");
            } else {
              const errMsg =
                (response.data &&
                  (response.data.message ||
                    (response.data.error && response.data.error.message))) ||
                "Failed to reject ride request.";
              showMessageEl(driverMessage, errMsg, "error");
              button.disabled = false;
              button.removeAttribute("aria-busy");
              button.textContent = originalText;
            }
          } catch (e) {
            showMessageEl(driverMessage, "Network error during reject action.", "error");
            button.disabled = false;
            button.removeAttribute("aria-busy");
            button.textContent = originalText;
          }
        }

        // 3. START TRIP ACTION
        if (action === "start-trip") {
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
          const originalText = button.textContent;
          button.textContent = "Starting...";

          try {
            const url = API_CONFIG.getDriverStartTripUrl
              ? API_CONFIG.getDriverStartTripUrl(tripId)
              : `/api/trips/${tripId}/start`;

            const response = await apiRequest(url, "POST");

            if (response.ok) {
              const req = state.requests.find(
                (r) => String(r.request_id || r.id) === String(reqId)
              );
              if (req) req.status = "started";
              renderRequestsTable(state.requests, container);
              updateRequestCounts();
              showMessageEl(
                driverMessage,
                `Trip #TR-${tripId} started! Drive safely to the destination.`,
                "success"
              );
            } else {
              const errMsg =
                (response.data &&
                  (response.data.message ||
                    (response.data.error && response.data.error.message))) ||
                "Failed to start trip.";
              showMessageEl(driverMessage, errMsg, "error");
              button.disabled = false;
              button.removeAttribute("aria-busy");
              button.textContent = originalText;
            }
          } catch (e) {
            showMessageEl(driverMessage, "Network error during start action.", "error");
            button.disabled = false;
            button.removeAttribute("aria-busy");
            button.textContent = originalText;
          }
        }

        // 4. COMPLETE TRIP ACTION (Opens Confirmation Modal)
        if (action === "complete-trip") {
          openCompleteTripModal({
            requestId: reqId,
            tripId: tripId,
            fare: button.dataset.estimate || 0,
            pickup: button.dataset.pickup || "Pickup Location",
            drop: button.dataset.drop || "Destination"
          });
        }
      });
    });

    // Reset Demo Button
    const resetRequestsBtn = document.getElementById("resetRequests");
    if (resetRequestsBtn) {
      resetRequestsBtn.addEventListener("click", () => {
        try {
        } catch (e) {}
        fetchDriverRequests();
        const msg = document.getElementById("driverMessage");
        if (msg) showMessageEl(msg, "Demo ride requests reset to initial queue.");
      });
    }

    // Refresh Queue Button
    const refreshBtn = document.getElementById("refreshRequestsBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        fetchDriverRequests();
      });
    }
  }

  /* ==========================================================================
     Complete Trip Modal Controller
     ========================================================================== */

  function initCompleteTripModal() {
    const modal = document.getElementById("completeTripModal");
    if (!modal) return;

    const closeBtn = document.getElementById("closeCompleteModalBtn");
    const cancelBtn = document.getElementById("cancelCompleteBtn");
    const confirmBtn = document.getElementById("confirmCompleteBtn");
    const fareInput = document.getElementById("completeFinalFareInput");
    const errorEl = document.getElementById("completeModalError");

    function closeModal() {
      modal.hidden = true;
      state.pendingCompleteTrip = null;
      if (errorEl) errorEl.hidden = true;
    }

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    if (confirmBtn && fareInput) {
      confirmBtn.addEventListener("click", async () => {
        if (!state.pendingCompleteTrip) return;

        const tripId = state.pendingCompleteTrip.tripId;
        const reqId = state.pendingCompleteTrip.requestId;

        confirmBtn.disabled = true;
        confirmBtn.setAttribute("aria-busy", "true");
        confirmBtn.textContent = "Recording Fare...";

        try {
          const url = API_CONFIG.getDriverCompleteTripUrl
            ? API_CONFIG.getDriverCompleteTripUrl(tripId)
            : `/api/trips/${tripId}/complete`;

          const response = await apiRequest(url, "POST");

          if (response.ok) {
            closeModal();
            const req = state.requests.find(
              (r) => String(r.request_id || r.id) === String(reqId)
            );
            if (req) {
              req.status = "completed";
              req.final_fare = response.data.final_fare;
            }

            await updateAvailabilityUI("available");

            const tbody =
              document.getElementById("requestsBody") ||
              document.getElementById("overviewRequestsBody");
            renderRequestsTable(state.requests, tbody);
            updateRequestCounts();

            // Refresh earnings if on earnings page or overview
            fetchDriverEarnings();

            const driverMsg = document.getElementById("driverMessage");
            if (driverMsg) {
              const finalFare = Number(response.data.final_fare || 0);
              showMessageEl(
                driverMsg,
                `Trip #TR-${tripId} marked as completed! ₹${finalFare.toFixed(
                  2
                )} added to your earnings statement.`,
                "success"
              );
            }
          } else {
            const msg =
              (response.data &&
                (response.data.message ||
                  (response.data.error && response.data.error.message))) ||
              "Failed to complete trip.";
            if (errorEl) showMessageEl(errorEl, msg, "error");
          }
        } catch (e) {
          if (errorEl) {
            showMessageEl(
              errorEl,
              "Network failure while completing trip.",
              "error"
            );
          }
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.removeAttribute("aria-busy");
          confirmBtn.textContent = "Confirm & Complete Trip";
        }
      });
    }
  }

  function openCompleteTripModal(data) {
    const modal = document.getElementById("completeTripModal");
    if (!modal) return;

    state.pendingCompleteTrip = data;

    const titleEl = document.getElementById("completeModalTripId");
    const routeEl = document.getElementById("completeModalRoute");
    const fareInput = document.getElementById("completeFinalFareInput");
    const errorEl = document.getElementById("completeModalError");

    if (titleEl) titleEl.textContent = `#TR-${data.tripId}`;
    if (routeEl) routeEl.textContent = `Route: ${data.pickup} → ${data.drop}`;
    if (fareInput) fareInput.value = parseFloat(data.fare || 0).toFixed(2);
    if (errorEl) errorEl.hidden = true;

    modal.hidden = false;
    if (fareInput) {
      fareInput.focus();
      fareInput.select();
    }
  }

  /* ==========================================================================
     Driver vehicle management controller
     ========================================================================== */

  async function fetchDriverVehicles() {
    const tbody = document.getElementById("vehiclesTableBody");
    const ovVehicleContent = document.getElementById("overviewVehicleContent");

    const endpoint = API_CONFIG.ENDPOINTS
      ? API_CONFIG.ENDPOINTS.driverVehicles
      : "/api/driver/vehicles";

    try {
      const response = await apiRequest(endpoint, "GET");

      if (response.ok && response.data && Array.isArray(response.data.vehicles)) {
        state.vehicles = response.data.vehicles;

        if (tbody) {
          renderVehiclesTable(state.vehicles, tbody);
          updateVehicleStats();
        }

        if (ovVehicleContent && state.vehicles.length > 0) {
          const primary = state.vehicles[0];
          const primaryImage = document.getElementById("ovVehicleImage");
          if (primaryImage) {
            primaryImage.src = `../assets/vehicles/${primary.vehicle_type || "standard"}.jpg`;
            primaryImage.alt = `${capitalize(primary.vehicle_type || "standard")} vehicle`;
            primaryImage.hidden = false;
          }
          document.getElementById("ovVehicleReg") &&
            (document.getElementById("ovVehicleReg").textContent =
              primary.registration_number);
          document.getElementById("ovVehicleModel") &&
            (document.getElementById("ovVehicleModel").textContent = `${
              primary.model
            } (${capitalize(primary.vehicle_type)})`);
          document.getElementById("ovVehicleCap") &&
            (document.getElementById("ovVehicleCap").textContent = `${
              primary.capacity
            } passengers`);
          const statusSpan = document.getElementById("ovVehicleStatus");
          if (statusSpan) {
            statusSpan.textContent = capitalize(primary.approval_status || "approved");
            statusSpan.className =
              "pill " +
              (primary.approval_status === "approved"
                ? "pill-success"
                : "pill-warning");
          }
        }
      }
    } catch (e) {
      console.error("Vehicles fetch error:", e);
    }
  }

  function renderVehiclesTable(vehicles, tbody) {
    if (!tbody) return;

    if (!vehicles || vehicles.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
        <div class="empty-state-icon">🚗</div>
        <div class="empty-state-title">No vehicles registered</div>
        <div class="empty-state-desc">Click "Add new vehicle" to register your first cab with CabGo.</div>
      </div></td></tr>`;
      return;
    }

    let html = "";
    vehicles.forEach((v) => {
      const vId = v.vehicle_id || v.id;
      const regNo = v.registration_number || "-";
      const vType = v.vehicle_type || "standard";
      const model = v.model || "-";
      const capacity = v.capacity || 4;
      const approval = (v.approval_status || "pending").toLowerCase();
      const isActive = v.is_active !== false;

      let approvalBadge = "";
      if (approval === "approved") {
        approvalBadge = '<span class="pill pill-success">Approved</span>';
      } else if (approval === "rejected") {
        approvalBadge = '<span class="pill pill-danger">Rejected</span>';
      } else {
        approvalBadge = '<span class="pill pill-warning">Pending Review</span>';
      }

      const activeBadge = isActive
        ? '<span class="pill pill-info">Active</span>'
        : '<span class="pill">Inactive</span>';

      const imageType = ["standard", "sedan", "suv"].includes(vType) ? vType : "standard";
      html += `
        <tr data-vehicle-id="${vId}">
          <td><strong>${escapeHtml(regNo)}</strong></td>
          <td style="text-transform:capitalize;">${escapeHtml(vType)}</td>
          <td><img class="vehicle-photo vehicle-photo-table" src="../assets/vehicles/${imageType}.jpg" alt="${escapeHtml(capitalize(imageType))} vehicle" loading="lazy"><span>${escapeHtml(model)}</span></td>
          <td>${capacity} seats</td>
          <td>${approvalBadge}</td>
          <td>${activeBadge}</td>
          <td>
            <button class="button button-small button-quiet" data-action="edit-vehicle" data-vehicle-id="${vId}" type="button">Edit</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  function updateVehicleStats() {
    const totalEl = document.getElementById("statTotalVehicles");
    const approvedEl = document.getElementById("statApprovedVehicles");
    const pendingEl = document.getElementById("statPendingVehicles");

    if (totalEl) totalEl.textContent = state.vehicles.length;
    if (approvedEl) {
      approvedEl.textContent = state.vehicles.filter(
        (v) => (v.approval_status || "approved").toLowerCase() === "approved"
      ).length;
    }
    if (pendingEl) {
      pendingEl.textContent = state.vehicles.filter(
        (v) => (v.approval_status || "pending").toLowerCase() === "pending"
      ).length;
    }
  }

  function initVehicleModals() {
    // Add Vehicle Modal
    const addModal = document.getElementById("addVehicleModal");
    const openAddBtn = document.getElementById("openAddVehicleBtn");
    const closeAddBtn = document.getElementById("closeAddVehicleModalBtn");
    const cancelAddBtn = document.getElementById("cancelAddVehicleBtn");
    const addForm = document.getElementById("addVehicleForm");

    function closeAddModal() {
      if (addModal) addModal.hidden = true;
      if (addForm) addForm.reset();
      clearVehicleFormErrors(addForm);
    }

    if (openAddBtn && addModal) {
      openAddBtn.addEventListener("click", () => {
        addModal.hidden = false;
        const regInput = document.getElementById("regNumberInput");
        if (regInput) regInput.focus();
      });
    }

    if (closeAddBtn) closeAddBtn.addEventListener("click", closeAddModal);
    if (cancelAddBtn) cancelAddBtn.addEventListener("click", closeAddModal);

    if (addForm) {
      addForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const regInput = document.getElementById("regNumberInput");
        const typeSelect = document.getElementById("vehicleTypeSelect");
        const modelInput = document.getElementById("modelInput");
        const capacityInput = document.getElementById("capacityInput");
        const msgEl = document.getElementById("addVehicleFormMessage");
        const submitBtn = document.getElementById("submitAddVehicleBtn");

        clearVehicleFormErrors(addForm);

        let isValid = true;
        const regVal = regInput ? regInput.value.trim().toUpperCase() : "";
        const typeVal = typeSelect ? typeSelect.value : "standard";
        const modelVal = modelInput ? modelInput.value.trim() : "";
        const capVal = capacityInput ? parseInt(capacityInput.value, 10) : 4;

        if (!regVal || regVal.length < 5) {
          setFieldMsg("regNumberError", "Enter a valid registration number (e.g. TN 09 AB 1234).");
          isValid = false;
        }

        if (!modelVal || modelVal.length < 2) {
          setFieldMsg("modelError", "Enter vehicle make and model (e.g. Maruti Swift).");
          isValid = false;
        }

        if (isNaN(capVal) || capVal < 1 || capVal > 8) {
          setFieldMsg("capacityError", "Capacity must be between 1 and 8 passengers.");
          isValid = false;
        }

        if (!isValid) return;

        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-busy", "true");
        const origText = submitBtn.textContent;
        submitBtn.textContent = "Saving...";

        try {
          const endpoint = API_CONFIG.ENDPOINTS
            ? API_CONFIG.ENDPOINTS.driverVehicles
            : "/api/driver/vehicles";

          const response = await apiRequest(endpoint, "POST", {
            registration_number: regVal,
            vehicle_type: typeVal,
            model: modelVal,
            capacity: capVal
          });

          if (response.ok && response.data) {
            closeAddModal();
            fetchDriverVehicles();
            const pageMsg = document.getElementById("vehicleMessage");
            if (pageMsg) {
              showMessageEl(
                pageMsg,
                `Vehicle ${regVal} registered successfully! Status is pending approval.`,
                "success"
              );
            }
          } else {
            const err =
              (response.data &&
                (response.data.message ||
                  (response.data.error && response.data.error.message))) ||
              "Failed to register vehicle.";
            if (msgEl) showMessageEl(msgEl, err, "error");
          }
        } catch (err) {
          if (msgEl) showMessageEl(msgEl, "Network error saving vehicle.", "error");
        } finally {
          submitBtn.disabled = false;
          submitBtn.removeAttribute("aria-busy");
          submitBtn.textContent = origText;
        }
      });
    }

    // Edit Vehicle Modal
    const editModal = document.getElementById("editVehicleModal");
    const closeEditBtn = document.getElementById("closeEditVehicleModalBtn");
    const cancelEditBtn = document.getElementById("cancelEditVehicleBtn");
    const editForm = document.getElementById("editVehicleForm");

    function closeEditModal() {
      if (editModal) editModal.hidden = true;
      if (editForm) editForm.reset();
    }

    if (closeEditBtn) closeEditBtn.addEventListener("click", closeEditModal);
    if (cancelEditBtn) cancelEditBtn.addEventListener("click", closeEditModal);

    // Event delegation on table body for Edit button
    const vTable = document.getElementById("vehiclesTableBody");
    if (vTable) {
      vTable.addEventListener("click", (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        const editBtn = target.closest("button[data-action='edit-vehicle']");
        if (!editBtn) return;

        const vId = editBtn.dataset.vehicleId;
        const vehicle = state.vehicles.find((v) => String(v.vehicle_id || v.id) === String(vId));
        if (!vehicle) return;

        document.getElementById("editVehicleId").value = vId;
        document.getElementById("editRegNumberDisplay").value = vehicle.registration_number;
        document.getElementById("editVehicleTypeSelect").value = vehicle.vehicle_type || "standard";
        document.getElementById("editModelInput").value = vehicle.model || "";
        document.getElementById("editCapacityInput").value = vehicle.capacity || 4;
        document.getElementById("editIsActiveCheckbox").checked = vehicle.is_active !== false;

        const msgEl = document.getElementById("editVehicleFormMessage");
        if (msgEl) msgEl.hidden = true;

        if (editModal) editModal.hidden = false;
      });
    }

    if (editForm) {
      editForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const vId = document.getElementById("editVehicleId").value;
        const model = document.getElementById("editModelInput").value.trim();
        const vType = document.getElementById("editVehicleTypeSelect").value;
        const capacity = parseInt(document.getElementById("editCapacityInput").value, 10);
        const isActive = document.getElementById("editIsActiveCheckbox").checked;
        const submitBtn = document.getElementById("submitEditVehicleBtn");
        const msgEl = document.getElementById("editVehicleFormMessage");

        if (!model) {
          setFieldMsg("editModelError", "Model is required.");
          return;
        }

        submitBtn.disabled = true;
        submitBtn.setAttribute("aria-busy", "true");
        const origText = submitBtn.textContent;
        submitBtn.textContent = "Updating...";

        try {
          const url = API_CONFIG.getDriverVehicleItemUrl
            ? API_CONFIG.getDriverVehicleItemUrl(vId)
            : `/api/driver/vehicles/${vId}`;

          const response = await apiRequest(url, "PUT", {
            model: model,
            vehicle_type: vType,
            capacity: capacity,
            is_active: isActive
          });

          if (response.ok) {
            closeEditModal();
            fetchDriverVehicles();
            const pageMsg = document.getElementById("vehicleMessage");
            if (pageMsg) {
              showMessageEl(pageMsg, "Vehicle updated successfully.", "success");
            }
          } else {
            const err =
              (response.data &&
                (response.data.message ||
                  (response.data.error && response.data.error.message))) ||
              "Failed to update vehicle.";
            if (msgEl) showMessageEl(msgEl, err, "error");
          }
        } catch (e) {
          if (msgEl) showMessageEl(msgEl, "Network error updating vehicle.", "error");
        } finally {
          submitBtn.disabled = false;
          submitBtn.removeAttribute("aria-busy");
          submitBtn.textContent = origText;
        }
      });
    }

    // Refresh vehicles button
    const refreshVehiclesBtn = document.getElementById("refreshVehiclesBtn");
    if (refreshVehiclesBtn) {
      refreshVehiclesBtn.addEventListener("click", fetchDriverVehicles);
    }
  }

  function setFieldMsg(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function clearVehicleFormErrors(form) {
    if (!form) return;
    form.querySelectorAll(".field-error").forEach((el) => {
      el.textContent = "";
    });
    const msg = form.querySelector(".message");
    if (msg) msg.hidden = true;
  }

  /* ==========================================================================
     Driver earnings controller
     ========================================================================== */

  async function fetchDriverEarnings() {
    const endpoint = API_CONFIG.ENDPOINTS
      ? API_CONFIG.ENDPOINTS.driverEarnings
      : "/api/driver/earnings";

    const tbody = document.getElementById("earningsTableBody");
    const overviewEarnings = document.getElementById("overviewEarningsRows");

    try {
      const response = await apiRequest(endpoint, "GET");

      if (response.ok && response.data && response.data.earnings) {
        state.earnings = response.data.earnings;

        renderEarningsPage(state.earnings, tbody);
        renderOverviewEarnings(state.earnings, overviewEarnings);
      }
    } catch (e) {
      console.error("Earnings fetch error:", e);
    }
  }

  function renderEarningsPage(earnings, tbody) {
    const totalEl = document.getElementById("earningsTotal");
    const countEl = document.getElementById("earningsCount");
    const avgEl = document.getElementById("earningsAverage");
    const maxEl = document.getElementById("earningsMax");

    const total = parseFloat(earnings.total_earnings || 0);
    const count = parseInt(earnings.completed_trips_count || 0, 10);
    const avg = parseFloat(earnings.average_fare || 0);
    const trips = earnings.trips || [];

    const maxFare = trips.reduce(
      (m, t) => Math.max(m, parseFloat(t.final_fare || 0)),
      0
    );

    if (totalEl) totalEl.textContent = formatFare(total);
    if (countEl) countEl.textContent = count;
    if (avgEl) avgEl.textContent = formatFare(avg);
    if (maxEl) maxEl.textContent = formatFare(maxFare);

    // Overview stats on dashboard.html (authoritative completed-trip count from the DB)
    const ovTotal = document.getElementById("statTotalEarnings");
    const ovAvg = document.getElementById("statAvgFare");
    const ovCompleted = document.getElementById("statCompletedTrips");
    const ovSubtext = document.getElementById("statTripsSubtext");
    if (ovTotal) ovTotal.textContent = formatFare(total);
    if (ovAvg) ovAvg.textContent = formatFare(avg);
    if (ovCompleted) ovCompleted.textContent = count;
    if (ovSubtext) ovSubtext.textContent = count === 1 ? "1 trip completed" : `${count} trips completed`;

    if (!tbody) return;

    if (!trips || trips.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
        <div class="empty-state-icon">💰</div>
        <div class="empty-state-title">No completed trips yet</div>
        <div class="empty-state-desc">Once you complete rides, your fares and itemized earnings will appear here.</div>
      </div></td></tr>`;
      return;
    }

    let html = "";
    trips.forEach((t) => {
      const tripId = t.trip_id || t.request_id;
      const passenger = t.passenger_name || "Passenger";
      const route = `${t.pickup_location || "-"} → ${t.drop_location || "-"}`;
      const vehicle = `${t.vehicle_model || "Swift"} (${t.registration_number || "TN 09 AB 1234"})`;
      const fare = parseFloat(t.final_fare || 0);
      const dateStr = t.completed_at
        ? new Date(t.completed_at).toLocaleString("en-IN", {
            dateStyle: "medium",
            timeStyle: "short"
          })
        : "Recent";

      html += `
        <tr>
          <td><strong>#TR-${tripId}</strong></td>
          <td>${escapeHtml(dateStr)}</td>
          <td>${escapeHtml(passenger)}</td>
          <td>${escapeHtml(route)}</td>
          <td>${escapeHtml(vehicle)}</td>
          <td><strong style="color:#166534;">${formatFare(fare)}</strong></td>
          <td><span class="pill pill-success">Completed</span></td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  }

  function renderOverviewEarnings(earnings, container) {
    if (!container) return;

    const trips = earnings.trips || [];
    if (trips.length === 0) {
      container.innerHTML = `<p class="muted" style="padding:10px 0;">No completed trips recorded yet.</p>`;
      return;
    }

    let html = "";
    trips.slice(0, 4).forEach((t) => {
      const tripId = t.trip_id || t.request_id;
      const fare = parseFloat(t.final_fare || 0);
      const route = `${t.pickup_location || ""} → ${t.drop_location || ""}`;
      html += `
        <div class="earning-row">
          <div>
            <span>Trip #TR-${tripId}</span>
            <div class="muted" style="font-size:11px;">${escapeHtml(route)}</div>
          </div>
          <strong>${formatFare(fare)}</strong>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  /* ==========================================================================
     Day 1 & 2 Compatibility (Admin and SuperAdmin Placeholders)
     ========================================================================== */

  /* ==========================================================================
     Admin and super admin module controllers
     ========================================================================== */

  function syncAdminSession() {
    const session = getSession();
    const userChip = document.querySelector(".user-chip");
    if (userChip) {
      if (session && session.user && session.user.role === "admin") {
        userChip.textContent = `${session.user.full_name || session.user.name} · ADM-${session.user.user_id || session.user.id || "01"}`;
      } else {
        userChip.textContent = "Administrator";
      }
    }

    const logoutBtns = document.querySelectorAll("#adminLogoutBtn, [data-action='logout']");
    logoutBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        clearSession();
        window.location.href = "../login.html";
      });
    });
  }

  function syncSuperAdminSession() {
    const session = getSession();
    const userChip = document.querySelector(".user-chip");
    if (userChip) {
      if (session && session.user && session.user.role === "super_admin") {
        userChip.textContent = `${session.user.full_name || session.user.name} · SA-${session.user.user_id || session.user.id || "01"}`;
      } else {
        userChip.textContent = "System Owner · SA-01";
      }
    }

    const logoutBtns = document.querySelectorAll("#superLogoutBtn, [data-action='logout']");
    logoutBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        clearSession();
        window.location.href = "../login.html";
      });
    });
  }

  /* --------------------------------------------------------------------------
     Admin Module: Overview Dashboard
     -------------------------------------------------------------------------- */
  async function initAdminDashboard() {
    syncAdminSession();

    // 1. Fetch Stats
    try {
      const res = await apiRequest(API_CONFIG.ENDPOINTS.adminStats || "/api/admin/stats");
      if (res.ok && res.data) {
        const stats = res.data;
        const passEl = document.getElementById("statPassengers");
        if (passEl) passEl.textContent = Number(stats.total_passengers || 0).toLocaleString();

        const drvEl = document.getElementById("statDrivers");
        if (drvEl) drvEl.textContent = Number(stats.total_drivers || 0).toLocaleString();

        const tripEl = document.getElementById("statActiveTrips");
        if (tripEl) tripEl.textContent = Number(stats.active_trips || 0).toLocaleString();

        const revEl = document.getElementById("statRevenue");
        if (revEl) revEl.textContent = formatFare(stats.today_revenue || 0);
      }
    } catch (e) {
      console.warn("Could not load admin stats", e);
    }

    // 2. Fetch Driver Review Queue
    loadAdminReviewQueue();

    // 3. Fetch Vehicle Summary
    try {
      const vRes = await apiRequest(API_CONFIG.ENDPOINTS.adminVehicles || "/api/admin/vehicles");
      if (vRes.ok && vRes.data && Array.isArray(vRes.data.vehicles)) {
        const vList = vRes.data.vehicles;
        const approved = vList.filter(v => v.approval_status === "approved").length;
        const pending = vList.filter(v => v.approval_status === "pending").length;
        const inactive = vList.filter(v => !v.is_active || v.approval_status === "rejected").length;

        const elApp = document.getElementById("approvedVehiclesCount");
        if (elApp) elApp.textContent = approved;
        const elPen = document.getElementById("reviewVehiclesCount");
        if (elPen) elPen.textContent = pending;
        const elIna = document.getElementById("inactiveVehiclesCount");
        if (elIna) elIna.textContent = inactive;
      }
    } catch (e) {}

    // 4. Fetch Fare Rules Summary
    try {
      const fRes = await apiRequest(API_CONFIG.ENDPOINTS.adminFareRules || "/api/admin/fare-rules");
      if (fRes.ok && fRes.data && Array.isArray(fRes.data.fare_rules)) {
        const stdRule = fRes.data.fare_rules.find(r => r.vehicle_type === "standard");
        if (stdRule) {
          const baseEl = document.getElementById("hatchbackBaseFare");
          if (baseEl) baseEl.textContent = `₹${Number(stdRule.base_fare).toFixed(2)}`;
          const kmEl = document.getElementById("perKmRate");
          if (kmEl) kmEl.textContent = `₹${Number(stdRule.per_km_rate).toFixed(2)}`;
          const minEl = document.getElementById("perMinuteRate");
          if (minEl) minEl.textContent = `₹${Number(stdRule.per_minute_rate).toFixed(2)}`;
        }
      }
    } catch (e) {}

    // 5. Fetch Recent Trips
    loadAdminRecentTrips();
  }

  async function loadAdminReviewQueue() {
    const queueBody = document.getElementById("adminReviewQueueBody");
    const adminMsg = document.getElementById("adminMessage");
    if (!queueBody) return;

    try {
      const res = await apiRequest(API_CONFIG.ENDPOINTS.adminDrivers || "/api/admin/drivers");
      if (res.ok && res.data && Array.isArray(res.data.drivers)) {
        const drivers = res.data.drivers;
        if (drivers.length === 0) {
          queueBody.innerHTML = `<tr><td colspan="4" class="empty-state">No driver applications in queue.</td></tr>`;
          return;
        }

        queueBody.innerHTML = drivers.map(d => {
          let statusPill = `<span class="pill">${escapeHtml(capitalize(d.verification_status))}</span>`;
          if (d.verification_status === "approved") {
            statusPill = `<span class="pill pill-success">Verified</span>`;
          } else if (d.verification_status === "pending") {
            statusPill = `<span class="pill pill-warning">Pending</span>`;
          } else if (d.verification_status === "rejected") {
            statusPill = `<span class="pill pill-danger">Rejected</span>`;
          }

          let actions = "";
          if (d.verification_status === "pending") {
            actions = `
              <button class="button button-small button-success" data-action="approve-driver" data-id="${d.driver_id}">Approve</button>
              <button class="button button-small button-quiet" data-action="reject-driver" data-id="${d.driver_id}">Reject</button>
            `;
          } else if (d.verification_status === "approved") {
            actions = `<button class="button button-small button-quiet" data-action="block-driver" data-id="${d.driver_id}">Block</button>`;
          } else {
            actions = `<button class="button button-small" data-action="approve-driver" data-id="${d.driver_id}">Re-approve</button>`;
          }

          return `
            <tr>
              <td><strong>${escapeHtml(d.full_name)}</strong><br><small class="muted">${escapeHtml(d.email)}</small></td>
              <td>${escapeHtml(d.license_number)}</td>
              <td>${statusPill}</td>
              <td>${actions}</td>
            </tr>
          `;
        }).join("");

        // Bind Action Buttons
        queueBody.querySelectorAll("[data-action='approve-driver']").forEach(btn => {
          btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const res = await apiRequest(`/api/admin/drivers/${id}/approve`, "POST");
            if (res.ok && adminMsg) {
              adminMsg.textContent = res.data.message || `Driver #${id} approved successfully.`;
              adminMsg.className = "message success";
              loadAdminReviewQueue();
            }
          });
        });

        queueBody.querySelectorAll("[data-action='reject-driver']").forEach(btn => {
          btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const res = await apiRequest(`/api/admin/drivers/${id}/reject`, "POST");
            if (res.ok && adminMsg) {
              adminMsg.textContent = res.data.message || `Driver #${id} rejected.`;
              adminMsg.className = "message";
              loadAdminReviewQueue();
            }
          });
        });

        queueBody.querySelectorAll("[data-action='block-driver']").forEach(btn => {
          btn.addEventListener("click", async () => {
            const id = btn.dataset.id;
            const res = await apiRequest(`/api/admin/drivers/${id}/block`, "POST");
            if (res.ok && adminMsg) {
              adminMsg.textContent = res.data.message || `Driver #${id} blocked.`;
              adminMsg.className = "message";
              loadAdminReviewQueue();
            }
          });
        });
      }
    } catch (e) {
      console.warn("Failed to load review queue", e);
    }
  }

  async function loadAdminRecentTrips() {
    const tableBody = document.getElementById("adminRecentTripsBody");
    if (!tableBody) return;

    try {
      const res = await apiRequest(API_CONFIG.ENDPOINTS.adminTrips || "/api/admin/trips");
      if (res.ok && res.data && Array.isArray(res.data.trips)) {
        const trips = res.data.trips.slice(0, 5);
        if (trips.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No recent trips found.</td></tr>`;
          return;
        }

        tableBody.innerHTML = trips.map(t => {
          let statusPill = `<span class="pill">${escapeHtml(capitalize(t.status))}</span>`;
          if (t.status === "completed") statusPill = `<span class="pill pill-success">Completed</span>`;
          if (t.status === "in_progress" || t.status === "started") statusPill = `<span class="pill pill-warning">In Progress</span>`;

          return `
            <tr>
              <td><strong>#TR-${t.trip_id}</strong></td>
              <td>${escapeHtml(t.driver_name || "Assigned Driver")}</td>
              <td>${escapeHtml(t.pickup_location)} &rarr; ${escapeHtml(t.drop_location)}</td>
              <td>${formatFare(t.final_fare || 0)}</td>
              <td>${statusPill}</td>
            </tr>
          `;
        }).join("");
      }
    } catch (e) {}
  }

  /* --------------------------------------------------------------------------
     Admin Module: Drivers Management (drivers.html)
     -------------------------------------------------------------------------- */
  async function initAdminDrivers() {
    syncAdminSession();
    const tableBody = document.getElementById("driversTableBody");
    const statusMsg = document.getElementById("driversPageMessage");
    const searchInput = document.getElementById("driverSearchInput");
    const statusFilter = document.getElementById("driverStatusFilter");

    let allDrivers = [];

    async function fetchDrivers() {
      if (!tableBody) return;
      tableBody.innerHTML = `<tr><td colspan="7" class="loading-state"><div class="spinner"></div> Loading driver roster...</td></tr>`;

      const res = await apiRequest(API_CONFIG.ENDPOINTS.adminDrivers || "/api/admin/drivers");
      if (res.ok && res.data && Array.isArray(res.data.drivers)) {
        allDrivers = res.data.drivers;
        renderDrivers();
      } else {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load drivers.</td></tr>`;
      }
    }

    function renderDrivers() {
      if (!tableBody) return;
      const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
      const filter = statusFilter ? statusFilter.value : "all";

      const filtered = allDrivers.filter(d => {
        const matchesQuery = !query ||
          d.full_name.toLowerCase().includes(query) ||
          d.email.toLowerCase().includes(query) ||
          d.license_number.toLowerCase().includes(query);

        const matchesStatus = filter === "all" || d.verification_status === filter;
        return matchesQuery && matchesStatus;
      });

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No drivers match your criteria.</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(d => {
        let vPill = `<span class="pill">${escapeHtml(capitalize(d.verification_status))}</span>`;
        if (d.verification_status === "approved") vPill = `<span class="pill pill-success">Verified</span>`;
        if (d.verification_status === "pending") vPill = `<span class="pill pill-warning">Pending</span>`;
        if (d.verification_status === "rejected") vPill = `<span class="pill pill-danger">Rejected</span>`;

        let aPill = `<span class="pill">${escapeHtml(capitalize(d.availability_status || "offline"))}</span>`;
        if (d.availability_status === "available") aPill = `<span class="pill pill-success">Online</span>`;
        if (d.availability_status === "on_trip") aPill = `<span class="pill pill-warning">On Trip</span>`;

        let actions = ``;
        if (d.verification_status === "pending") {
          actions = `
            <button class="button button-small button-success" data-action="approve" data-id="${d.driver_id}">Approve</button>
            <button class="button button-small button-quiet" data-action="reject" data-id="${d.driver_id}">Reject</button>
          `;
        } else if (d.verification_status === "approved") {
          actions = `<button class="button button-small button-quiet" data-action="block" data-id="${d.driver_id}">Block</button>`;
        } else {
          actions = `<button class="button button-small" data-action="approve" data-id="${d.driver_id}">Approve</button>`;
        }

        return `
          <tr>
            <td><strong>#DRV-${d.driver_id}</strong></td>
            <td><strong>${escapeHtml(d.full_name)}</strong><br><small class="muted">${escapeHtml(d.email)}</small></td>
            <td><code>${escapeHtml(d.license_number)}</code><br><small class="muted">Exp: ${escapeHtml(d.license_expiry || "N/A")}</small></td>
            <td>${vPill}</td>
            <td>${aPill}</td>
            <td>${d.rating != null ? `<span class="star">★</span> ${Number(d.rating).toFixed(1)}` : '<span class="muted">New</span>'}</td>
            <td>${actions}</td>
          </tr>
        `;
      }).join("");

      // Bind actions
      tableBody.querySelectorAll("[data-action='approve']").forEach(b => {
        b.addEventListener("click", async () => {
          const res = await apiRequest(`/api/admin/drivers/${b.dataset.id}/approve`, "POST");
          if (res.ok && statusMsg) {
            statusMsg.textContent = res.data.message;
            statusMsg.className = "message success";
            fetchDrivers();
          }
        });
      });

      tableBody.querySelectorAll("[data-action='reject']").forEach(b => {
        b.addEventListener("click", async () => {
          const res = await apiRequest(`/api/admin/drivers/${b.dataset.id}/reject`, "POST");
          if (res.ok && statusMsg) {
            statusMsg.textContent = res.data.message;
            statusMsg.className = "message";
            fetchDrivers();
          }
        });
      });

      tableBody.querySelectorAll("[data-action='block']").forEach(b => {
        b.addEventListener("click", async () => {
          const res = await apiRequest(`/api/admin/drivers/${b.dataset.id}/block`, "POST");
          if (res.ok && statusMsg) {
            statusMsg.textContent = res.data.message;
            statusMsg.className = "message";
            fetchDrivers();
          }
        });
      });
    }

    if (searchInput) searchInput.addEventListener("input", renderDrivers);
    if (statusFilter) statusFilter.addEventListener("change", renderDrivers);

    fetchDrivers();
  }

  /* --------------------------------------------------------------------------
     Admin Module: Passengers Management (passengers.html)
     -------------------------------------------------------------------------- */
  async function initAdminPassengers() {
    syncAdminSession();
    const tableBody = document.getElementById("passengersTableBody");
    const statusMsg = document.getElementById("passengersPageMessage");
    const searchInput = document.getElementById("passengerSearchInput");

    let allPassengers = [];

    async function fetchPassengers() {
      if (!tableBody) return;
      tableBody.innerHTML = `<tr><td colspan="6" class="loading-state"><div class="spinner"></div> Loading passenger accounts...</td></tr>`;

      const res = await apiRequest(API_CONFIG.ENDPOINTS.adminPassengers || "/api/admin/passengers");
      if (res.ok && res.data && Array.isArray(res.data.passengers)) {
        allPassengers = res.data.passengers;
        renderPassengers();
      } else {
        tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load passengers.</td></tr>`;
      }
    }

    function renderPassengers() {
      if (!tableBody) return;
      const query = searchInput ? searchInput.value.trim().toLowerCase() : "";

      const filtered = allPassengers.filter(p => {
        return !query ||
          p.full_name.toLowerCase().includes(query) ||
          p.email.toLowerCase().includes(query);
      });

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No passengers found.</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(p => {
        const isBlocked = p.status === "blocked";
        const statusPill = isBlocked
          ? `<span class="pill pill-danger">Blocked</span>`
          : `<span class="pill pill-success">Active</span>`;

        const actionBtn = isBlocked
          ? `<button class="button button-small button-success" data-action="toggle" data-id="${p.user_id}">Unblock</button>`
          : `<button class="button button-small button-quiet" data-action="toggle" data-id="${p.user_id}">Block</button>`;

        const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString() : "Recent";

        return `
          <tr>
            <td><strong>#USR-${p.user_id}</strong></td>
            <td><strong>${escapeHtml(p.full_name)}</strong></td>
            <td>${escapeHtml(p.email)}</td>
            <td>${p.total_trips || 0} rides</td>
            <td>${statusPill}</td>
            <td>${actionBtn}</td>
          </tr>
        `;
      }).join("");

      tableBody.querySelectorAll("[data-action='toggle']").forEach(b => {
        b.addEventListener("click", async () => {
          const res = await apiRequest(`/api/admin/passengers/${b.dataset.id}/toggle-block`, "POST");
          if (res.ok && statusMsg) {
            statusMsg.textContent = res.data.message;
            statusMsg.className = "message success";
            fetchPassengers();
          }
        });
      });
    }

    if (searchInput) searchInput.addEventListener("input", renderPassengers);
    fetchPassengers();
  }

  /* --------------------------------------------------------------------------
     Admin Module: Vehicles Fleet (vehicles.html)
     -------------------------------------------------------------------------- */
  async function initAdminVehicles() {
    syncAdminSession();
    const tableBody = document.getElementById("adminVehiclesTableBody");
    const statusMsg = document.getElementById("vehiclesPageMessage");

    async function fetchVehicles() {
      if (!tableBody) return;
      tableBody.innerHTML = `<tr><td colspan="7" class="loading-state"><div class="spinner"></div> Loading vehicle fleet...</td></tr>`;

      const res = await apiRequest(API_CONFIG.ENDPOINTS.adminVehicles || "/api/admin/vehicles");
      if (res.ok && res.data && Array.isArray(res.data.vehicles)) {
        const vehicles = res.data.vehicles;
        if (vehicles.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No vehicles in registry.</td></tr>`;
          return;
        }

        tableBody.innerHTML = vehicles.map(v => {
          let sPill = `<span class="pill">${escapeHtml(capitalize(v.approval_status))}</span>`;
          if (v.approval_status === "approved") sPill = `<span class="pill pill-success">Approved</span>`;
          if (v.approval_status === "pending") sPill = `<span class="pill pill-warning">Under Review</span>`;
          if (v.approval_status === "rejected") sPill = `<span class="pill pill-danger">Rejected</span>`;

          let actions = "";
          if (v.approval_status === "pending") {
            actions = `
              <button class="button button-small button-success" data-action="approve-v" data-id="${v.vehicle_id}">Approve</button>
              <button class="button button-small button-quiet" data-action="reject-v" data-id="${v.vehicle_id}">Reject</button>
            `;
          } else if (v.approval_status === "approved") {
            actions = `<button class="button button-small button-quiet" data-action="reject-v" data-id="${v.vehicle_id}">Revoke</button>`;
          } else {
            actions = `<button class="button button-small" data-action="approve-v" data-id="${v.vehicle_id}">Re-approve</button>`;
          }

          const imageType = ["standard", "sedan", "suv"].includes(v.vehicle_type) ? v.vehicle_type : "standard";
          return `
            <tr>
              <td><strong>${escapeHtml(v.registration_number)}</strong></td>
              <td>${escapeHtml(v.driver_name || "Arjun S.")}</td>
              <td><img class="vehicle-photo vehicle-photo-table" src="../assets/vehicles/${imageType}.jpg" alt="${escapeHtml(capitalize(imageType))} vehicle" loading="lazy"><span>${escapeHtml(v.model)}</span></td>
              <td><span class="pill">${escapeHtml(capitalize(v.vehicle_type))}</span></td>
              <td>${v.capacity} seats</td>
              <td>${sPill}</td>
              <td>${actions}</td>
            </tr>
          `;
        }).join("");

        tableBody.querySelectorAll("[data-action='approve-v']").forEach(b => {
          b.addEventListener("click", async () => {
            const res = await apiRequest(`/api/admin/vehicles/${b.dataset.id}/approve`, "POST");
            if (res.ok && statusMsg) {
              statusMsg.textContent = res.data.message;
              statusMsg.className = "message success";
              fetchVehicles();
            }
          });
        });

        tableBody.querySelectorAll("[data-action='reject-v']").forEach(b => {
          b.addEventListener("click", async () => {
            const res = await apiRequest(`/api/admin/vehicles/${b.dataset.id}/reject`, "POST");
            if (res.ok && statusMsg) {
              statusMsg.textContent = res.data.message;
              statusMsg.className = "message";
              fetchVehicles();
            }
          });
        });
      }
    }

    fetchVehicles();
  }

  /* --------------------------------------------------------------------------
     Admin Module: Fare Rules (fares.html)
     -------------------------------------------------------------------------- */
  async function initAdminFares() {
    syncAdminSession();
    const tableBody = document.getElementById("fareRulesTableBody");
    const statusMsg = document.getElementById("faresPageMessage");
    const modal = document.getElementById("editFareModal");
    const modalForm = document.getElementById("editFareForm");
    const modalCloseBtn = document.getElementById("closeEditFareModalBtn");
    const cancelModalBtn = document.getElementById("cancelEditFareBtn");

    let currentEditingRuleId = null;

    async function fetchFares() {
      if (!tableBody) return;
      tableBody.innerHTML = `<tr><td colspan="6" class="loading-state"><div class="spinner"></div> Loading fare rules...</td></tr>`;

      const res = await apiRequest(API_CONFIG.ENDPOINTS.adminFareRules || "/api/admin/fare-rules");
      if (res.ok && res.data && Array.isArray(res.data.fare_rules)) {
        const rules = res.data.fare_rules;
        tableBody.innerHTML = rules.map(r => {
          return `
            <tr>
              <td><strong>${escapeHtml(capitalize(r.vehicle_type))}</strong></td>
              <td>₹${Number(r.base_fare).toFixed(2)}</td>
              <td>₹${Number(r.per_km_rate).toFixed(2)} / km</td>
              <td>₹${Number(r.per_minute_rate).toFixed(2)} / min</td>
              <td><span class="pill pill-success">Active</span></td>
              <td>
                <button class="button button-small" data-action="edit-fare"
                  data-id="${r.fare_rule_id}"
                  data-type="${r.vehicle_type}"
                  data-base="${r.base_fare}"
                  data-km="${r.per_km_rate}"
                  data-min="${r.per_minute_rate}">Edit Rule</button>
              </td>
            </tr>
          `;
        }).join("");

        tableBody.querySelectorAll("[data-action='edit-fare']").forEach(b => {
          b.addEventListener("click", () => {
            currentEditingRuleId = b.dataset.id;
            const typeInput = document.getElementById("fareVehicleType");
            const baseInput = document.getElementById("fareBaseRate");
            const kmInput = document.getElementById("farePerKm");
            const minInput = document.getElementById("farePerMin");

            if (typeInput) typeInput.value = capitalize(b.dataset.type);
            if (baseInput) baseInput.value = b.dataset.base;
            if (kmInput) kmInput.value = b.dataset.km;
            if (minInput) minInput.value = b.dataset.min;

            if (modal) modal.hidden = false;
          });
        });
      }
    }

    if (modalCloseBtn) modalCloseBtn.addEventListener("click", () => { if (modal) modal.hidden = true; });
    if (cancelModalBtn) cancelModalBtn.addEventListener("click", () => { if (modal) modal.hidden = true; });

    if (modalForm) {
      modalForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const base = document.getElementById("fareBaseRate").value;
        const km = document.getElementById("farePerKm").value;
        const min = document.getElementById("farePerMin").value;

        const res = await apiRequest(`/api/admin/fare-rules/${currentEditingRuleId}`, "PUT", {
          base_fare: parseFloat(base),
          per_km_rate: parseFloat(km),
          per_minute_rate: parseFloat(min)
        });

        if (modal) modal.hidden = true;

        if (res.ok && statusMsg) {
          statusMsg.textContent = res.data.message || "Fare rule updated successfully.";
          statusMsg.className = "message success";
          fetchFares();
        }
      });
    }

    fetchFares();
  }

  /* --------------------------------------------------------------------------
     Admin Module: Trips View (trips.html)
     -------------------------------------------------------------------------- */
  async function initAdminTrips() {
    syncAdminSession();
    const tableBody = document.getElementById("adminTripsTableBody");
    const statusFilter = document.getElementById("tripStatusFilter");

    let allTrips = [];

    async function fetchTrips() {
      if (!tableBody) return;
      tableBody.innerHTML = `<tr><td colspan="7" class="loading-state"><div class="spinner"></div> Loading trips data...</td></tr>`;

      const res = await apiRequest(API_CONFIG.ENDPOINTS.adminTrips || "/api/admin/trips");
      if (res.ok && res.data && Array.isArray(res.data.trips)) {
        allTrips = res.data.trips;
        renderTrips();
      } else {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No trips recorded.</td></tr>`;
      }
    }

    function renderTrips() {
      if (!tableBody) return;
      const filter = statusFilter ? statusFilter.value : "all";

      const filtered = allTrips.filter(t => {
        if (filter === "all") return true;
        return t.status === filter;
      });

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No trips matching filter.</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(t => {
        let sPill = `<span class="pill">${escapeHtml(capitalize(t.status))}</span>`;
        if (t.status === "completed") sPill = `<span class="pill pill-success">Completed</span>`;
        if (t.status === "in_progress" || t.status === "started") sPill = `<span class="pill pill-warning">In Progress</span>`;

        return `
          <tr>
            <td><strong>#TR-${t.trip_id}</strong></td>
            <td>${escapeHtml(t.passenger_name || "Passenger")}</td>
            <td>${escapeHtml(t.driver_name || "Driver")}</td>
            <td>${escapeHtml(t.pickup_location)} &rarr; ${escapeHtml(t.drop_location)}</td>
            <td><span class="pill">${escapeHtml(capitalize(t.vehicle_type || "standard"))}</span></td>
            <td><strong>${formatFare(t.final_fare || 0)}</strong></td>
            <td>${sPill}</td>
          </tr>
        `;
      }).join("");
    }

    if (statusFilter) statusFilter.addEventListener("change", renderTrips);
    fetchTrips();
  }

  /* --------------------------------------------------------------------------
     Super Admin Module: Dashboard Overview
     -------------------------------------------------------------------------- */
  async function initSuperAdminDashboard() {
    syncSuperAdminSession();

    // 1. Stats
    try {
      const res = await apiRequest(API_CONFIG.ENDPOINTS.superadminStats || "/api/superadmin/stats");
      if (res.ok && res.data) {
        const stats = res.data;
        const elAdmins = document.getElementById("statTotalAdmins");
        if (elAdmins) elAdmins.textContent = Number(stats.total_admins ?? 0).toLocaleString();
        const elActive = document.getElementById("statActiveAdmins");
        if (elActive) elActive.textContent = Number(stats.active_admins ?? 0).toLocaleString();
        const elGroups = document.getElementById("statGroups");
        if (elGroups) elGroups.textContent = stats.permission_groups == null ? "N/A" : stats.permission_groups;
        const elEvents = document.getElementById("statEvents");
        if (elEvents) elEvents.textContent = stats.events_today == null ? "N/A" : stats.events_today;
      }
    } catch (e) {}

    // 2. Admins summary
    const adminSummaryBody = document.getElementById("superAdminsSummaryBody");
    if (adminSummaryBody) {
      try {
        const aRes = await apiRequest(API_CONFIG.ENDPOINTS.superadminAdmins || "/api/superadmin/admins");
        if (aRes.ok && aRes.data && Array.isArray(aRes.data.admins)) {
          const admins = aRes.data.admins.slice(0, 4);
          adminSummaryBody.innerHTML = admins.map(a => `
            <tr>
              <td><strong>${escapeHtml(a.full_name)}</strong></td>
              <td>${escapeHtml(a.email)}</td>
              <td>${escapeHtml(a.department || "Operations")}</td>
              <td><span class="pill ${a.status === 'active' ? 'pill-success' : 'pill-warning'}">${capitalize(a.status)}</span></td>
            </tr>
          `).join("");
        }
      } catch (e) {}
    }

    // 3. Recent logs summary
    const logsSummaryBody = document.getElementById("superLogsSummaryBody");
    if (logsSummaryBody) {
      try {
        const lRes = await apiRequest(API_CONFIG.ENDPOINTS.superadminLogs || "/api/superadmin/logs");
        if (lRes.ok && lRes.data && Array.isArray(lRes.data.logs)) {
          const logs = lRes.data.logs.slice(0, 4);
          logsSummaryBody.innerHTML = logs.map(l => `
            <tr>
              <td><small class="muted">${escapeHtml(l.timestamp)}</small></td>
              <td>${escapeHtml(l.actor)}</td>
              <td>${escapeHtml(l.action)}</td>
              <td><span class="pill ${l.status === 'success' ? 'pill-success' : (l.status === 'warning' ? 'pill-warning' : '')}">${capitalize(l.status)}</span></td>
            </tr>
          `).join("");
        }
      } catch (e) {}
    }
  }

  /* --------------------------------------------------------------------------
     Super Admin Module: Administrator Accounts (admins.html)
     -------------------------------------------------------------------------- */
  async function initSuperAdminAdmins() {
    syncSuperAdminSession();
    const tableBody = document.getElementById("adminsTableBody");
    const statusMsg = document.getElementById("adminsPageMessage");
    const addBtn = document.getElementById("openAddAdminModalBtn");
    const modal = document.getElementById("addAdminModal");
    const modalForm = document.getElementById("addAdminForm");
    const closeBtn = document.getElementById("closeAddAdminModalBtn");
    const cancelBtn = document.getElementById("cancelAddAdminBtn");

    async function fetchAdmins() {
      if (!tableBody) return;
      tableBody.innerHTML = `<tr><td colspan="6" class="loading-state"><div class="spinner"></div> Loading administrator accounts...</td></tr>`;

      const res = await apiRequest(API_CONFIG.ENDPOINTS.superadminAdmins || "/api/superadmin/admins");
      if (res.ok && res.data && Array.isArray(res.data.admins)) {
        const admins = res.data.admins;
        tableBody.innerHTML = admins.map(a => {
          const isAct = a.status === "active";
          const isSuper = a.role === "super_admin";

          return `
            <tr>
              <td><strong>#ADM-${a.user_id}</strong></td>
              <td><strong>${escapeHtml(a.full_name)}</strong></td>
              <td>${escapeHtml(a.email)}</td>
              <td>${escapeHtml(a.department || "Operations")}</td>
              <td><span class="pill ${isAct ? 'pill-success' : 'pill-warning'}">${capitalize(a.status)}</span></td>
              <td>
                ${isSuper
                  ? `<span class="pill pill-purple">System Owner</span>`
                  : `<button class="button button-small ${isAct ? 'button-quiet' : 'button-success'}" data-action="toggle-admin" data-id="${a.user_id}">${isAct ? 'Deactivate' : 'Activate'}</button>`
                }
              </td>
            </tr>
          `;
        }).join("");

        tableBody.querySelectorAll("[data-action='toggle-admin']").forEach(b => {
          b.addEventListener("click", async () => {
            const res = await apiRequest(`/api/superadmin/admins/${b.dataset.id}/toggle`, "POST");
            if (res.ok && statusMsg) {
              statusMsg.textContent = res.data.message;
              statusMsg.className = "message success";
              fetchAdmins();
            }
          });
        });
      }
    }

    if (addBtn) addBtn.addEventListener("click", () => { if (modal) modal.hidden = false; });
    if (closeBtn) closeBtn.addEventListener("click", () => { if (modal) modal.hidden = true; });
    if (cancelBtn) cancelBtn.addEventListener("click", () => { if (modal) modal.hidden = true; });

    if (modalForm) {
      modalForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("adminFullName").value.trim();
        const email = document.getElementById("adminEmail").value.trim();
        const dept = document.getElementById("adminDepartment").value;
        const pass = document.getElementById("adminPassword").value;

        const res = await apiRequest(API_CONFIG.ENDPOINTS.superadminAdmins || "/api/superadmin/admins", "POST", {
          full_name: name,
          email: email,
          department: dept,
          password: pass
        });

        if (modal) modal.hidden = true;
        modalForm.reset();

        if (res.ok && statusMsg) {
          statusMsg.textContent = res.data.message;
          statusMsg.className = "message success";
          fetchAdmins();
        } else if (statusMsg) {
          statusMsg.textContent = (res.data && res.data.message) || "Could not add administrator.";
          statusMsg.className = "message error";
        }
      });
    }

    fetchAdmins();
  }

  /* --------------------------------------------------------------------------
     Super Admin Module: Permissions Matrix (permissions.html)
     -------------------------------------------------------------------------- */
  function initSuperAdminPermissions() {
    syncSuperAdminSession();
    // Static declarative matrix rendered in permissions.html
  }

  /* --------------------------------------------------------------------------
     Super Admin Module: System Settings (settings.html)
     -------------------------------------------------------------------------- */
  async function initSuperAdminSettings() {
    syncSuperAdminSession();
    const form = document.getElementById("settingsForm");
    const statusMsg = document.getElementById("settingsPageMessage");

    try {
      const res = await apiRequest(API_CONFIG.ENDPOINTS.superadminSettings || "/api/superadmin/settings");
      if (res.ok && res.data && res.data.settings) {
        const s = res.data.settings;
        const elName = document.getElementById("settingPlatformName");
        if (elName) elName.value = s.platform_name || "";

        const elComm = document.getElementById("settingCommission");
        if (elComm) elComm.value = s.driver_commission_percentage || 15;

        const elRadius = document.getElementById("settingRadius");
        if (elRadius) elRadius.value = s.max_search_radius_km || 15;

        const elEmail = document.getElementById("settingSupportEmail");
        if (elEmail) elEmail.value = s.support_email || "support@cabgo.local";

        const elMaint = document.getElementById("settingMaintenance");
        if (elMaint) elMaint.checked = Boolean(s.maintenance_mode);

        const elBooking = document.getElementById("settingBookingEnabled");
        if (elBooking) elBooking.checked = Boolean(s.booking_enabled);
      }
    } catch (e) {}

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          platform_name: document.getElementById("settingPlatformName").value,
          driver_commission_percentage: Number(document.getElementById("settingCommission").value),
          max_search_radius_km: Number(document.getElementById("settingRadius").value),
          support_email: document.getElementById("settingSupportEmail").value,
          maintenance_mode: document.getElementById("settingMaintenance").checked,
          booking_enabled: document.getElementById("settingBookingEnabled").checked
        };

        const res = await apiRequest(API_CONFIG.ENDPOINTS.superadminSettings || "/api/superadmin/settings", "PUT", payload);
        if (res.ok && statusMsg) {
          statusMsg.textContent = res.data.message || "System settings saved successfully.";
          statusMsg.className = "message success";
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     Super Admin Module: System Logs (logs.html)
     -------------------------------------------------------------------------- */
  async function initSuperAdminLogs() {
    syncSuperAdminSession();
    const tableBody = document.getElementById("logsTableBody");
    const filterInput = document.getElementById("logSearchInput");

    let allLogs = [];

    async function fetchLogs() {
      if (!tableBody) return;
      tableBody.innerHTML = `<tr><td colspan="5" class="loading-state"><div class="spinner"></div> Loading system audit logs...</td></tr>`;

      const res = await apiRequest(API_CONFIG.ENDPOINTS.superadminLogs || "/api/superadmin/logs");
      if (res.ok && res.data && Array.isArray(res.data.logs)) {
        allLogs = res.data.logs;
        renderLogs();
      } else {
        tableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No audit logs found.</td></tr>`;
      }
    }

    function renderLogs() {
      if (!tableBody) return;
      const query = filterInput ? filterInput.value.trim().toLowerCase() : "";

      const filtered = allLogs.filter(l => {
        return !query ||
          l.actor.toLowerCase().includes(query) ||
          l.action.toLowerCase().includes(query) ||
          (l.details && l.details.toLowerCase().includes(query));
      });

      if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No matching log records.</td></tr>`;
        return;
      }

      tableBody.innerHTML = filtered.map(l => {
        let pillClass = "";
        if (l.status === "success") pillClass = "pill-success";
        if (l.status === "warning") pillClass = "pill-warning";
        if (l.status === "failed") pillClass = "pill-danger";

        return `
          <tr>
            <td><code>${escapeHtml(l.timestamp)}</code></td>
            <td><strong>${escapeHtml(l.actor)}</strong></td>
            <td>${escapeHtml(l.action)}</td>
            <td><span class="pill ${pillClass}">${escapeHtml(capitalize(l.status))}</span></td>
            <td><small class="muted">${escapeHtml(l.details || "")}</small></td>
          </tr>
        `;
      }).join("");
    }

    if (filterInput) filterInput.addEventListener("input", renderLogs);
    fetchLogs();
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function capitalize(str) {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /* ==========================================================================
     Initialization Router
     ========================================================================== */

  async function requirePageRole(expectedRole) {
    const response = await apiRequest("/api/me", "GET");
    if (!response.ok || !response.data || !response.data.user) {
      return false;
    }

    if (response.data.user.role !== expectedRole) {
      clearSession();
      window.location.replace("../login.html?forbidden=1");
      return false;
    }

    return true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateDataModeBadge();

    const role = document.body ? document.body.dataset.role : "";
    const page = document.body ? document.body.dataset.page : "";

    // Driver flow
    if (role === "driver-login") {
      initDriverLogin();
      return;
    }

    if (role === "driver") {
      requirePageRole("driver").then((authorized) => {
        if (!authorized) return;
        syncDriverSession();
        initAvailabilityControls();
        initRideRequestActions();
        initCompleteTripModal();
        initVehicleModals();

        const refreshEarningsBtn = document.getElementById("refreshEarningsBtn");
        if (refreshEarningsBtn) {
          refreshEarningsBtn.addEventListener("click", fetchDriverEarnings);
        }

        fetchDriverRequests();
        fetchDriverVehicles();
        fetchDriverEarnings();
      });
      return;
    }

    // Admin module routes
    if (role === "admin") {
      requirePageRole("admin").then((authorized) => {
        if (!authorized) return;
        syncAdminSession();
        if (page === "admin-dashboard" || !page) initAdminDashboard();
        if (page === "admin-drivers") initAdminDrivers();
        if (page === "admin-passengers") initAdminPassengers();
        if (page === "admin-vehicles") initAdminVehicles();
        if (page === "admin-fares") initAdminFares();
        if (page === "admin-trips") initAdminTrips();
      });
      return;
    }

    // Super Admin module routes
    if (role === "superadmin") {
      requirePageRole("super_admin").then((authorized) => {
        if (!authorized) return;
        syncSuperAdminSession();
        if (page === "superadmin-dashboard" || !page) initSuperAdminDashboard();
        if (page === "superadmin-admins") initSuperAdminAdmins();
        if (page === "superadmin-permissions") initSuperAdminPermissions();
        if (page === "superadmin-settings") initSuperAdminSettings();
        if (page === "superadmin-logs") initSuperAdminLogs();
      });
      return;
    }
  });
})();