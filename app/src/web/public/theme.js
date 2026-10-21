// Applies the saved theme before the page renders to avoid a flash of the wrong colors.
(function () {
  var choice = "system";
  try {
    choice = localStorage.getItem("pt-theme") || "system";
  } catch (e) {
    choice = "system";
  }
  var dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
