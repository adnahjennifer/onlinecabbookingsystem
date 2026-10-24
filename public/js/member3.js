// Member 3 Day 1: UI-only demo interactions. No backend/API is connected yet.
document.addEventListener("DOMContentLoaded", () => {
  const role = document.body.dataset.role;
  const messageIds = { driver: "driverMessage", admin: "adminMessage", superadmin: "superMessage" };
  const message = document.getElementById(messageIds[role]);
  const showMessage = (text) => {
    if (message) message.textContent = text;
  };

  const availabilityBtn = document.getElementById("availabilityBtn");
  if (availabilityBtn) {
    let online = true;
    availabilityBtn.addEventListener("click", () => {
      online = !online;
      availabilityBtn.textContent = online ? "Go offline" : "Go online";
      availabilityBtn.classList.toggle("button-success", online);
      showMessage(`Demo status changed: driver is now ${online ? "online" : "offline"}. This is not saved to a server.`);
    });
  }

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      const messages = {
        accept: "Demo only: ride request accepted in the page preview. No booking was changed on a server.",
        reject: "Demo only: ride request rejected in the page preview. No booking was changed on a server.",
        approve: "Demo only: driver approval action selected. No database record was changed.",
        block: "Demo only: reject/block action selected. No account was changed.",
        "add-admin": "Demo only: Add administrator selected. A real form and API will be added later.",
        activate: "Demo only: activate administrator selected. No account was changed.",
        deactivate: "Demo only: deactivate administrator selected. No account was changed.",
        setting: "Demo only: settings control selected. This change is not persisted."
      };
      showMessage(messages[action] || "Demo action selected.");
    });
  });
});


const loginForm = document.getElementById("driverLoginForm");
if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = document.getElementById("email");
    const password = document.getElementById("password");
    const message = document.getElementById("loginMessage");
    message.className = "message";
    if (!email.value.trim() || !password.value) {
      message.textContent = "Please enter both your email and password.";
      message.classList.add("error");
      return;
    }
    if (!email.checkValidity()) {
      message.textContent = "Please enter a valid email address.";
      message.classList.add("error");
      email.focus();
      return;
    }
    if (password.value.length < 6) {
      message.textContent = "Password must contain at least 6 characters for this demo.";
      message.classList.add("error");
      password.focus();
      return;
    }
    message.textContent = "Demo form validated. Opening dashboard preview; this is not real authentication.";
    message.classList.add("success");
    window.setTimeout(() => { window.location.href = "dashboard.html"; }, 700);
  });
}
