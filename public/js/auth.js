/**
 * CabGo - Online Cab Booking System
 * Passenger Authentication Controller (Day 2)
 * Handles client-side validation, password toggles, submission, and auth redirection.
 */

"use strict";

/**
 * Role redirection map for CabGo user roles.
 * Driver, admin, and super_admin dashboards use the shared dashboard controller.
 */
const ROLE_REDIRECTS = {
    passenger: "passenger-dashboard.html",
    driver: "driver/dashboard.html",
    admin: "admin/dashboard.html",
    super_admin: "superadmin/dashboard.html"
};

// Immediate guard: If an active session already exists, redirect directly to dashboard.
(function checkExistingSession() {
    if (typeof getSession === "function") {
        const session = getSession();
        if (session && session.user) {
            const role = session.user.role || "passenger";
            const targetPage = ROLE_REDIRECTS[role] || "passenger-dashboard.html";
            window.location.replace(targetPage);
        }
    }
})();

document.addEventListener("DOMContentLoaded", function () {
    initPasswordToggles();
    initRegistrationForm();
    initLoginForm();
    checkRegisteredUrlBanner();
    const demoCredentials = document.getElementById("demoCredentials");
    if (demoCredentials && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
        demoCredentials.hidden = false;
    }
});

/* ==========================================================================
   Password Visibility Toggle
   ========================================================================== */

function initPasswordToggles() {
    const toggleButtons = document.querySelectorAll(".password-toggle-btn");

    toggleButtons.forEach((btn) => {
        btn.addEventListener("click", function () {
            const targetId = btn.getAttribute("data-toggle");
            const input = document.getElementById(targetId);

            if (!input) {
                return;
            }

            const isPassword = input.type === "password";
            input.type = isPassword ? "text" : "password";
            btn.textContent = isPassword ? "Hide" : "Show";
            btn.setAttribute(
                "aria-label",
                isPassword ? "Hide password" : "Show password"
            );
        });
    });
}

/* ==========================================================================
   Validation Helpers
   ========================================================================== */

/**
 * Updates inline field error, aria-invalid, and aria-describedby.
 */
function setFieldError(input, errorElement, message) {
    if (!input || !errorElement) {
        return;
    }

    if (message) {
        errorElement.textContent = message;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", errorElement.id);
    } else {
        errorElement.textContent = "";
        input.removeAttribute("aria-invalid");
    }
}

/**
 * Clears all inline errors and status messages on a form.
 */
function clearFormErrors(form) {
    const inputs = form.querySelectorAll("input");
    inputs.forEach((input) => {
        input.removeAttribute("aria-invalid");
    });

    const errors = form.querySelectorAll(".field-error");
    errors.forEach((err) => {
        err.textContent = "";
    });

    const msg = document.getElementById("formMessage");
    if (msg) {
        msg.hidden = true;
        msg.textContent = "";
        msg.className = "message";
    }
}

/**
 * Registration field validation rules
 */
function validateRegisterName(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) {
        return "Please enter your full name.";
    }
    if (trimmed.length < 2 || trimmed.length > 60) {
        return "Name must be between 2 and 60 characters.";
    }
    const nameRegex = /^[A-Za-z\s.'-]+$/;
    if (!nameRegex.test(trimmed)) {
        return "Name can only contain letters, spaces, hyphens, periods, and apostrophes.";
    }
    return "";
}

function validateRegisterEmail(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) {
        return "Please enter your email address.";
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
        return "Please enter a valid email address (e.g. user@example.com).";
    }
    return "";
}

function validateRegisterPassword(value) {
    const pwd = value || "";
    if (!pwd) {
        return "Please enter a password.";
    }
    if (pwd.length < 8) {
        return "Password must be at least 8 characters long.";
    }
    const hasLetter = /[A-Za-z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    if (!hasLetter || !hasNumber) {
        return "Password must contain at least one letter and one number.";
    }
    return "";
}

function validateRegisterConfirmPassword(confirmValue, passwordValue) {
    const confirm = confirmValue || "";
    if (!confirm) {
        return "Please confirm your password.";
    }
    if (confirm !== passwordValue) {
        return "Passwords do not match.";
    }
    return "";
}

/**
 * Login field validation rules (non-empty & email format only)
 */
function validateLoginEmail(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) {
        return "Please enter your email address.";
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
        return "Please enter a valid email address.";
    }
    return "";
}

function validateLoginPassword(value) {
    if (!value) {
        return "Please enter your password.";
    }
    return "";
}

/* ==========================================================================
   Registration Form Handler
   ========================================================================== */

function initRegistrationForm() {
    const registerForm = document.getElementById("registerForm");
    if (!registerForm) {
        return;
    }

    const nameInput = document.getElementById("name");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const submitBtn = registerForm.querySelector('button[type="submit"]');
    const formMessage = document.getElementById("formMessage");

    const nameError = document.getElementById("nameError");
    const emailError = document.getElementById("emailError");
    const passwordError = document.getElementById("passwordError");
    const confirmPasswordError = document.getElementById("confirmPasswordError");

    let isSubmitting = false;

    // Real-time validation on blur
    if (nameInput) {
        nameInput.addEventListener("blur", () => {
            setFieldError(nameInput, nameError, validateRegisterName(nameInput.value));
        });
        nameInput.addEventListener("input", () => {
            if (nameInput.getAttribute("aria-invalid") === "true") {
                setFieldError(nameInput, nameError, validateRegisterName(nameInput.value));
            }
        });
    }

    if (emailInput) {
        emailInput.addEventListener("blur", () => {
            setFieldError(emailInput, emailError, validateRegisterEmail(emailInput.value));
        });
        emailInput.addEventListener("input", () => {
            if (emailInput.getAttribute("aria-invalid") === "true") {
                setFieldError(emailInput, emailError, validateRegisterEmail(emailInput.value));
            }
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener("blur", () => {
            setFieldError(passwordInput, passwordError, validateRegisterPassword(passwordInput.value));
            if (confirmPasswordInput && confirmPasswordInput.value) {
                setFieldError(
                    confirmPasswordInput,
                    confirmPasswordError,
                    validateRegisterConfirmPassword(confirmPasswordInput.value, passwordInput.value)
                );
            }
        });
        passwordInput.addEventListener("input", () => {
            if (passwordInput.getAttribute("aria-invalid") === "true") {
                setFieldError(passwordInput, passwordError, validateRegisterPassword(passwordInput.value));
            }
            if (confirmPasswordInput && confirmPasswordInput.value) {
                setFieldError(
                    confirmPasswordInput,
                    confirmPasswordError,
                    validateRegisterConfirmPassword(confirmPasswordInput.value, passwordInput.value)
                );
            }
        });
    }

    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener("blur", () => {
            setFieldError(
                confirmPasswordInput,
                confirmPasswordError,
                validateRegisterConfirmPassword(confirmPasswordInput.value, passwordInput.value)
            );
        });
        confirmPasswordInput.addEventListener("input", () => {
            if (confirmPasswordInput.getAttribute("aria-invalid") === "true") {
                setFieldError(
                    confirmPasswordInput,
                    confirmPasswordError,
                    validateRegisterConfirmPassword(confirmPasswordInput.value, passwordInput.value)
                );
            }
        });
    }

    // Submit handler
    registerForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (isSubmitting) {
            return;
        }

        // Validate all fields
        const nameErr = validateRegisterName(nameInput.value);
        const emailErr = validateRegisterEmail(emailInput.value);
        const pwdErr = validateRegisterPassword(passwordInput.value);
        const confirmErr = validateRegisterConfirmPassword(
            confirmPasswordInput.value,
            passwordInput.value
        );

        setFieldError(nameInput, nameError, nameErr);
        setFieldError(emailInput, emailError, emailErr);
        setFieldError(passwordInput, passwordError, pwdErr);
        setFieldError(confirmPasswordInput, confirmPasswordError, confirmErr);

        // Focus first invalid input if any
        if (nameErr) {
            nameInput.focus();
            return;
        }
        if (emailErr) {
            emailInput.focus();
            return;
        }
        if (pwdErr) {
            passwordInput.focus();
            return;
        }
        if (confirmErr) {
            confirmPasswordInput.focus();
            return;
        }

        // Loading state
        isSubmitting = true;
        setButtonLoading(submitBtn, true, "Creating account...");

        if (formMessage) {
            formMessage.hidden = true;
        }

        try {
            // NEVER send confirmPassword to the server
            const payload = {
                name: nameInput.value.trim(),
                email: emailInput.value.trim().toLowerCase(),
                password: passwordInput.value
            };

            const response = await apiRequest(
                API_CONFIG.ENDPOINTS.register,
                "POST",
                payload
            );

            if (response.ok && response.status === 201) {
                registerForm.reset();
                clearFormErrors(registerForm);
                showMessage(
                    formMessage,
                    "Registration successful! Redirecting to login...",
                    "success"
                );

                setTimeout(() => {
                    window.location.href = "login.html?registered=1";
                }, 1500);
            } else {
                // Server error handling (400, 409, 500, network error)
                const errorCode = response.data && response.data.error ? response.data.error.code : "";
                let errorMsg = getErrorMessage(
                    response.data,
                    response.status === 0
                        ? "Cannot reach the server. Please check your connection."
                        : "Unable to create account. Please check your information and try again."
                );

                if (errorCode === "EMAIL_EXISTS") {
                    errorMsg = "An account with this email already exists.";
                    if (emailInput && emailError) {
                        setFieldError(emailInput, emailError, errorMsg);
                        emailInput.focus();
                    }
                } else if (errorCode === "WEAK_PASSWORD") {
                    errorMsg = "Password must be at least 8 characters long.";
                    if (passwordInput && passwordError) {
                        setFieldError(passwordInput, passwordError, errorMsg);
                        passwordInput.focus();
                    }
                } else if (errorCode === "INVALID_INPUT") {
                    errorMsg = (response.data && response.data.error && response.data.error.message) ||
                        "Please provide a valid name, email, and password.";
                }

                showMessage(formMessage, errorMsg, "error");

                // Place field-specific errors if returned
                if (response.data && response.data.errors) {
                    if (response.data.errors.email && emailInput && emailError) {
                        setFieldError(emailInput, emailError, response.data.errors.email);
                        emailInput.focus();
                    }
                    if (response.data.errors.name && nameInput && nameError) {
                        setFieldError(nameInput, nameError, response.data.errors.name);
                    }
                    if (response.data.errors.password && passwordInput && passwordError) {
                        setFieldError(passwordInput, passwordError, response.data.errors.password);
                    }
                }
            }
        } finally {
            isSubmitting = false;
            setButtonLoading(submitBtn, false);
        }
    });
}

/* ==========================================================================
   Login Form Handler
   ========================================================================== */

function initLoginForm() {
    const loginForm = document.getElementById("loginForm");
    if (!loginForm) {
        return;
    }

    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const formMessage = document.getElementById("formMessage");

    const emailError = document.getElementById("emailError");
    const passwordError = document.getElementById("passwordError");

    let isSubmitting = false;

    // Real-time validation
    if (emailInput) {
        emailInput.addEventListener("blur", () => {
            setFieldError(emailInput, emailError, validateLoginEmail(emailInput.value));
        });
        emailInput.addEventListener("input", () => {
            if (emailInput.getAttribute("aria-invalid") === "true") {
                setFieldError(emailInput, emailError, validateLoginEmail(emailInput.value));
            }
        });
    }

    if (passwordInput) {
        passwordInput.addEventListener("blur", () => {
            setFieldError(passwordInput, passwordError, validateLoginPassword(passwordInput.value));
        });
        passwordInput.addEventListener("input", () => {
            if (passwordInput.getAttribute("aria-invalid") === "true") {
                setFieldError(passwordInput, passwordError, validateLoginPassword(passwordInput.value));
            }
        });
    }

    // Submit handler
    loginForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (isSubmitting) {
            return;
        }

        const emailErr = validateLoginEmail(emailInput.value);
        const pwdErr = validateLoginPassword(passwordInput.value);

        setFieldError(emailInput, emailError, emailErr);
        setFieldError(passwordInput, passwordError, pwdErr);

        if (emailErr) {
            emailInput.focus();
            return;
        }
        if (pwdErr) {
            passwordInput.focus();
            return;
        }

        // Loading state
        isSubmitting = true;
        setButtonLoading(submitBtn, true, "Logging in...");

        if (formMessage) {
            formMessage.hidden = true;
        }

        try {
            const payload = {
                email: emailInput.value.trim().toLowerCase(),
                password: passwordInput.value
            };

            const response = await apiRequest(
                API_CONFIG.ENDPOINTS.login,
                "POST",
                payload
            );

            if (response.ok && response.status === 200 && response.data) {
                saveSession(response.data.user, response.data.token || null);

                showMessage(
                    formMessage,
                    response.data.message || "Login successful. Redirecting...",
                    "success"
                );

                const role =
                    response.data.user && response.data.user.role
                        ? response.data.user.role
                        : "passenger";
                const redirectTarget =
                    ROLE_REDIRECTS[role] || "passenger-dashboard.html";

                setTimeout(() => {
                    window.location.href = redirectTarget;
                }, 600);
            } else if (response.status === 401) {
                const errorMsg = (response.data && response.data.error && response.data.error.message) ||
                    "Invalid email or password.";
                showMessage(formMessage, errorMsg, "error");
                passwordInput.value = "";
                passwordInput.focus();
            } else {
                const message = getErrorMessage(
                    response.data,
                    response.status === 0
                        ? "Cannot reach the server. Please check your connection."
                        : "Login failed. Please check your credentials and try again."
                );
                showMessage(formMessage, message, "error");
            }
        } finally {
            isSubmitting = false;
            setButtonLoading(submitBtn, false);
        }
    });
}

/* ==========================================================================
   Registration Success / Session Expired Banner on Login Page
   ========================================================================== */

function checkRegisteredUrlBanner() {
    const params = new URLSearchParams(window.location.search);
    const formMessage = document.getElementById("formMessage");
    if (!formMessage) {
        return;
    }

    if (params.get("expired") === "1") {
        showMessage(formMessage, "Your session has expired. Please log in again.", "error");
    } else if (params.get("registered") === "1") {
        showMessage(formMessage, "Account created successfully. Please log in.", "success");
    }
}

if (typeof window !== "undefined") {
    window.ROLE_REDIRECTS = ROLE_REDIRECTS;
    window.validateRegisterName = validateRegisterName;
    window.validateRegisterEmail = validateRegisterEmail;
    window.validateRegisterPassword = validateRegisterPassword;
    window.validateRegisterConfirmPassword = validateRegisterConfirmPassword;
    window.validateLoginEmail = validateLoginEmail;
    window.validateLoginPassword = validateLoginPassword;
    window.checkRegisteredUrlBanner = checkRegisteredUrlBanner;
}
