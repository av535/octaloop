(function () {
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Close" : "Menu";
    });
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        document.body.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Menu";
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        document.body.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Menu";
      }
    });
  }

  var form = document.querySelector("#book-form");
  if (!form) return;

  var endpoint = "https://script.google.com/macros/s/AKfycbye43Z6vNU5yAreY6KMdDMTbLXRcnocqmhOSjA65vDIsOx3hAIWiMPPMWcd78y5x5K0/exec";
  var status = form.querySelector(".form-status");

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (form.querySelector("[name='company_website']").value) return;

    var data = new FormData(form);
    var website = data.get("website") || "";
    var category = data.get("category") || "";
    var goal = data.get("goal") || "";
    var note = data.get("note") || "";
    var pricing = goal === "Event growth" ? "retainer + commission" : "retainer";
    var payload = {
      formType: "bookCall",
      name: data.get("name"),
      company: category,
      email: data.get("email"),
      website: website,
      service: goal,
      budget: pricing,
      message: "Website: " + website + "\nCategory: " + category + "\nGoal: " + goal + "\n\n" + note
    };

    var button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "Sending…";
    status.className = "form-status";
    status.textContent = "";

    fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify(payload)
    }).then(function () {
      form.reset();
      status.className = "form-status ok";
      status.textContent = "Request sent. If you do not hear back, email events@octaloop.com.";
      button.textContent = "Book a call";
      button.disabled = false;
    }).catch(function () {
      status.className = "form-status err";
      status.textContent = "That did not send. Email events@octaloop.com and we will pick it up.";
      button.textContent = "Book a call";
      button.disabled = false;
    });
  });
})();
