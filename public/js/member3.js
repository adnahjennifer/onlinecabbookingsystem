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
