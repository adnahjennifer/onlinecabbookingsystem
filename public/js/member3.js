document.addEventListener("DOMContentLoaded", () => {
  const role = document.body.dataset.role;
  const messageIds = {
    driver: "driverMessage",
    admin: "adminMessage",
    superadmin: "superMessage"
  };

  const roleMessage = document.getElementById(messageIds[role]);

  const showRoleMessage = (text) => {
    if (roleMessage) roleMessage.textContent = text;
  };

  // DAY 1: Driver availability toggle and shared demo actions.
  const availabilityBtn = document.getElementById("availabilityBtn");
  const requestsBody = document.getElementById("requestsBody");

  // Use the general availability handler only on pages without ride requests.
  if (availabilityBtn && !requestsBody) {
    let online = true;

    availabilityBtn.addEventListener("click", () => {
      online = !online;
      availabilityBtn.textContent = online ? "Go offline" : "Go online";
      availabilityBtn.classList.toggle("button-success", online);

      showRoleMessage(
        `Demo status changed: driver is now ${online ? "online" : "offline"}. This is not saved to a server.`
      );
    });
  }

  // General demo actions. Ride-request buttons are handled separately below.
  document.querySelectorAll("[data-action]").forEach((button) => {
    if (button.closest("#requestsBody")) return;

    button.addEventListener("click", () => {
      const action = button.dataset.action;

      const messages = {
        accept: "Demo only: ride request accepted. No booking was changed on a server.",
        reject: "Demo only: ride request rejected. No booking was changed on a server.",
        approve: "Demo only: driver approval action selected. No database record was changed.",
        block: "Demo only: reject/block action selected. No account was changed.",
        "add-admin": "Demo only: Add administrator selected. A real form and API will be added later.",
        activate: "Demo only: activate administrator selected. No account was changed.",
        deactivate: "Demo only: deactivate administrator selected. No account was changed.",
        setting: "Demo only: settings control selected. This change is not persisted."
      };

      showRoleMessage(messages[action] || "Demo action selected.");
    });
  });

  // DAY 2: Driver login validation (demo only; not real authentication).
  const loginForm = document.getElementById("driverLoginForm");

  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const email = document.getElementById("email");
      const password = document.getElementById("password");
      const loginMessage = document.getElementById("loginMessage");

      if (!email || !password || !loginMessage) return;

      loginMessage.className = "message";

      if (!email.value.trim() || !password.value) {
        loginMessage.textContent = "Please enter both your email and password.";
        loginMessage.classList.add("error");
        return;
      }

      if (!email.checkValidity()) {
        loginMessage.textContent = "Please enter a valid email address.";
        loginMessage.classList.add("error");
        email.focus();
        return;
      }

      if (password.value.length < 6) {
        loginMessage.textContent =
          "Password must contain at least 6 characters for this demo.";
        loginMessage.classList.add("error");
        password.focus();
        return;
      }

      loginMessage.textContent =
        "Demo form validated. Opening dashboard preview; this is not real authentication.";
      loginMessage.classList.add("success");

      window.setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 700);
    });
  }

  // DAY 3: Ride requests, accept/reject, counters, availability, and reset.
  if (requestsBody) {
    const initialRows = requestsBody.innerHTML;
    const requestMessage = document.getElementById("driverMessage");
    const requestAvailabilityBtn = document.getElementById("availabilityBtn");
    const availabilityState = document.getElementById("availabilityState");
    const pendingCount = document.getElementById("pendingCount");
    const acceptedCount = document.getElementById("acceptedCount");
    const rejectedCount = document.getElementById("rejectedCount");
    const resetRequestsBtn = document.getElementById("resetRequests");

    let online = true;
    let accepted = 0;
    let rejected = 0;

    function showRequestMessage(text, kind = "") {
      if (!requestMessage) return;

      requestMessage.textContent = text;
      requestMessage.className = ("message " + kind).trim();
    }

    function updateCounts() {
      if (pendingCount) {
        pendingCount.textContent =
          requestsBody.querySelectorAll('tr[data-status="pending"]').length;
      }

      if (acceptedCount) acceptedCount.textContent = accepted;
      if (rejectedCount) rejectedCount.textContent = rejected;
    }

    function setAvailability() {
      if (availabilityState) {
        availabilityState.textContent = online
          ? "Online (demo)"
          : "Offline (demo)";

        availabilityState.className = online
          ? "pill pill-success"
          : "pill pill-warning";
      }

      if (requestAvailabilityBtn) {
        requestAvailabilityBtn.textContent = online
          ? "Go offline"
          : "Go online";

        requestAvailabilityBtn.classList.toggle("button-success", online);
      }

      requestsBody
        .querySelectorAll('tr[data-status="pending"] button')
        .forEach((button) => {
          button.disabled = !online;
        });
    }

    requestsBody.addEventListener("click", (event) => {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const button = target.closest("button[data-action]");
      if (!button) return;

      const row = button.closest("tr");

      if (!row || row.dataset.status !== "pending") return;

      if (!online) {
        showRequestMessage(
          "You are offline. Go online before responding to requests.",
          "error"
        );
        return;
      }

      const action = button.dataset.action;

      if (!["accept", "reject"].includes(action)) return;

      row.dataset.status = action === "accept" ? "accepted" : "rejected";

      const statusPill = row.querySelector(".status-pill");

      if (statusPill) {
        statusPill.textContent =
          action === "accept" ? "Accepted" : "Rejected";

        statusPill.className =
          "pill status-pill " +
          (action === "accept" ? "pill-success" : "");
      }

      const actions = row.querySelector(".actions");

      if (actions) {
        actions.textContent =
          action === "accept" ? "Accepted by you" : "Rejected by you";
      }

      if (action === "accept") {
        accepted++;
      } else {
        rejected++;
      }

      showRequestMessage(
        `Request ${row.dataset.requestId || ""} ${action} in the demo. No server or database was updated.`,
        action === "accept" ? "success" : ""
      );

      updateCounts();
    });

    if (requestAvailabilityBtn) {
      requestAvailabilityBtn.addEventListener("click", () => {
        online = !online;

        setAvailability();

        showRequestMessage(
          `Demo availability changed to ${online ? "online" : "offline"}. This is not saved to the server.`
        );
      });
    }

    if (resetRequestsBtn) {
      resetRequestsBtn.addEventListener("click", () => {
        requestsBody.innerHTML = initialRows;

        online = true;
        accepted = 0;
        rejected = 0;

        updateCounts();
        setAvailability();

        showRequestMessage("Demo requests reset. No server data was changed.");
      });
    }

    updateCounts();
    setAvailability();
  }
});