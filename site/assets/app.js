// Hidrata la página desde /config.json. Ningún texto vive en el HTML:
// cambiar el JSON cambia el sitio, sin tocar markup ni estilos.
(function () {
  "use strict";

  var pick = function (obj, path) {
    return path.split(".").reduce(function (o, k) {
      return o == null ? undefined : o[k];
    }, obj);
  };

  var pct = function (n) { return Math.round(n * 100) + "%"; };

  var render = function (cfg) {
    // enlaces declarativos data-bind / data-bind-pct
    document.querySelectorAll("[data-bind]").forEach(function (el) {
      var v = pick(cfg, el.getAttribute("data-bind"));
      if (v == null) return;
      el.textContent = Array.isArray(v)
        ? v.join(", ")
        : String(v);
    });
    document.querySelectorAll("[data-bind-pct]").forEach(function (el) {
      var v = pick(cfg, el.getAttribute("data-bind-pct"));
      if (typeof v === "number") el.textContent = pct(v);
    });

    document.title = cfg.marca.nombre + " — " + cfg.marca.tagline;

  };



  var animar = function () {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var llenar = function () {
      document.querySelectorAll("#ej-ejes .signal-val").forEach(function (b) {
        b.style.width = b.dataset.target;
      });
    };
    if (reduce || !("IntersectionObserver" in window)) return llenar();
    var card = document.querySelector(".healthcard");
    if (!card) return;
    var io = new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { llenar(); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(card);
  };

  fetch("/config.json")
    .then(function (r) {
      if (!r.ok) throw new Error("config.json respondió " + r.status);
      return r.json();
    })
    .then(function (cfg) {
      render(cfg);
    })
    .catch(function (e) {
      console.error(e);
      // La página queda con el contenido base del HTML: el analizador sigue funcionando.
    });
})();
