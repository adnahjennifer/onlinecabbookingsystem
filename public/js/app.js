
// Online Cab Booking System - Passenger Frontend
// Day 1: Browser-side interactions using sample data only.

document.addEventListener("DOMContentLoaded", function () {
    // Demonstration login form.
    const loginForm = document.getElementById("loginForm");

    if (loginForm) {
        loginForm.addEventListener("submit", function (event) {
            event.preventDefault();

            const email = document.getElementById("email").value.trim();
            const password = document.getElementById("password").value;
            const message = document.getElementById("formMessage");

            if (!email || !password) {
                showMessage(
                    message,
                    "Please enter your email and password.",
                    "error"
                );
                return;
            }

            showMessage(
                message,
                "Demo only: the login form works, but authentication is not connected yet.",
                "success"
            );
        });
    }

    // Demonstration registration form.
    const registerForm = document.getElementById("registerForm");

    if (registerForm) {
        registerForm.addEventListener("submit", function (event) {
            event.preventDefault();

            const name = document.getElementById("name").value.trim();
            const email = document.getElementById("email").value.trim();
            const password = document.getElementById("password").value;
            const confirmPassword =
                document.getElementById("confirmPassword").value;

            const message = document.getElementById("formMessage");

            if (!name || !email || !password || !confirmPassword) {
                showMessage(
                    message,
                    "Please complete all required fields.",
                    "error"
                );
                return;
            }

            if (password.length < 8) {
                showMessage(
                    message,
                    "Password must contain at least 8 characters.",
                    "error"
                );
                return;
            }

            if (password !== confirmPassword) {
                showMessage(
                    message,
                    "The passwords do not match.",
                    "error"
                );
                return;
            }

            showMessage(
                message,
                "Demo only: registration validation passed. An account has not been created.",
                "success"
            );
        });
    }

    // Passenger search form.
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

function showMessage(element, text, type) {
    if (!element) {
        return;
    }

    element.textContent = text;
    element.className = "message " + type;
    element.hidden = false;
}
