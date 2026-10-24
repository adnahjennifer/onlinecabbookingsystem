// Online Cab Booking System - Passenger Frontend
// Day 1 & Day 2: Client interactions and passenger portal logic.

"use strict";

document.addEventListener("DOMContentLoaded", function () {
    // Dashboard greeting & session guard
    const passengerGreeting = document.getElementById("passengerName");
    if (passengerGreeting) {
        const session = typeof getSession === "function" ? getSession() : null;
        if (!session || !session.user) {
            window.location.replace("login.html");
            return;
        }
        if (session.user && session.user.name) {
            passengerGreeting.textContent = session.user.name;
        }
    }

    // Passenger search form (sample demonstration).
    const searchForm = document.getElementById("searchForm");

    if (searchForm) {
        searchForm.addEventListener("submit", function (event) {
            event.preventDefault();

            const pickup = document.getElementById("pickup").value.trim();
            const destination =
                document.getElementById("destination").value.trim();

            const message = document.getElementById("searchMessage");

            if (!pickup || !destination) {
                showMessage(
                    message,
                    "Enter both pickup and destination locations.",
                    "error"
                );
                return;
            }

            if (pickup.toLowerCase() === destination.toLowerCase()) {
                showMessage(
                    message,
                    "Pickup and destination must be different.",
                    "error"
                );
                return;
            }

            showMessage(
                message,
                "Demo only: search details accepted. Available cabs and fares will be connected later.",
                "success"
            );
        });
    }

    // Demo cancellation for the sample booking.
    const cancelButton = document.getElementById("cancelBooking");

    if (cancelButton) {
        cancelButton.addEventListener("click", function () {
            const confirmed = window.confirm(
                "Cancel this sample booking?"
            );

            if (confirmed) {
                const status = document.getElementById("bookingStatus");

                if (status) {
                    status.textContent = "Cancelled (demo)";
                    status.className = "badge";
                }

                cancelButton.disabled = true;
                cancelButton.textContent = "Cancelled";
            }
        });
    }
});

/**
 * Shared message display helper.
 */
function showMessage(element, text, type) {
    if (!element) {
        return;
    }

    element.textContent = text;
    element.className = "message " + (type || "");
    element.hidden = false;
}
