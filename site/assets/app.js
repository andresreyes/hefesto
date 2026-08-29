// Hidrata la página desde /config.json. Ningún texto vive en el HTML:
// cambiar el JSON cambia el sitio, sin tocar markup ni estilos.
(function () {
  "use strict";

  var pick = function (o, p) {
    return p.split(".").reduce(function (x, k) { return x == null ? undefined : x[k]; }, o);
  };
  var pct = function (n) { return Math.round(n * 100) + "%"; };
  var $ = function (s) { return document.querySelector(s); };
  var byId = function (i) { return document.getElementById(i); };

  function barra(nombre, valor, objetivo) {
    var li = document.createElement("li");
    li.className = "signal-row";
    li.innerHTML = '<span class="signal-name"></span>' +
      '<span class="signal-bar"><span class="signal-val"></span><span class="signal-mark"></span></span>' +
      '<span class="signal-num"></span>';
    li.querySelector(".signal-name").textContent = nombre;
    li.querySelector(".signal-num").textContent = pct(valor);
    li.querySelector(".signal-mark").style.left = pct(objetivo);
    var b = li.querySelector(".signal-val");
    b.classList.add(valor >= objetivo ? "ok" : "low");
    b.dataset.target = pct(valor);
    return li;
  }

  function render(cfg) {
    document.querySelectorAll("[data-bind]").forEach(function (el) {
      var v = pick(cfg, el.getAttribute("data-bind"));
      if (v == null) return;
      el.textContent = Array.isArray(v) ? v.join(" · ") : String(v);
    });
    document.querySelectorAll("[data-bind-pct]").forEach(function (el) {
      var v = pick(cfg, el.getAttribute("data-bind-pct"));
      if (typeof v === "number") el.textContent = pct(v);
    });
    document.title = cfg.marca.nombre + " — " + cfg.marca.tagline;

    // ── tarjeta de ejemplo ────────────────────────────────────────────────
    var t = cfg.tarjeta_ejemplo;
    if (t) {
      var num = $(".healthcard .hc-num");
      if (num) num.style.color = t.nota >= 80 ? "var(--healthy)" : t.nota >= 55 ? "var(--signal)" : "var(--burn)";
      byId("ej-ln").textContent = "L" + t.linea.n;

      var meta = byId("ej-meta");
      meta.style.width = "0";
      meta.dataset.target = t.nota + "%";
      meta.classList.add(t.nota >= 75 ? "ok" : "low");
      byId("ej-meta-mark").style.left = "75%";

      var ul = byId("ej-ejes");
      ul.innerHTML = "";
      t.ejes.forEach(function (s) { ul.appendChild(barra(s.nombre, s.valor, s.objetivo)); });
      animar();
    }

    // ── cómo funciona ─────────────────────────────────────────────────────
    var ol = byId("steps");
    ol.innerHTML = "";
    cfg.pasos.forEach(function (p, i) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="n"></span><h3></h3><p></p>';
      li.querySelector(".n").textContent = String(i + 1).padStart(2, "0");
      li.querySelector("h3").textContent = p.titulo;
      li.querySelector("p").textContent = p.texto;
      ol.appendChild(li);
    });

    // ── qué se mide ───────────────────────────────────────────────────────
    var dl = byId("sigex");
    dl.innerHTML = "";
    cfg.senales_explicadas.forEach(function (s) {
      var d = document.createElement("div");
      d.className = "sig-item";
      d.innerHTML = '<dt class="sig-w"></dt><dt class="sig-n"></dt><dd class="sig-d"></dd>';
      d.querySelector(".sig-w").textContent = "×" + s.peso.toFixed(2);
      d.querySelector(".sig-n").textContent = s.nombre;
      d.querySelector(".sig-d").textContent = s.texto;
      dl.appendChild(d);
    });

    var cta = byId("ctalink");
    cta.textContent = cfg.cta.texto;
    cta.href = cfg.cta.url;

    byId("footline").textContent =
      [cfg.pie.propietario, cfg.pie.anio, cfg.pie.licencia].join(" · ");
  }

  // Las barras crecen al entrar en pantalla; con reduced-motion aparecen llenas.
  function animar() {
    var llenar = function () {
      document.querySelectorAll(".healthcard [data-target]").forEach(function (b) {
        b.style.width = b.dataset.target;
      });
    };
    var card = $(".healthcard");
    if (!card) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        !("IntersectionObserver" in window)) return llenar();
    var io = new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { llenar(); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(card);
  }

  fetch("/config.json")
    .then(function (r) {
      if (!r.ok) throw new Error("config.json respondió " + r.status);
      return r.json();
    })
    .then(render)
    .catch(function (e) {
      console.error(e);
      // El analizador no depende del config: sigue funcionando aunque esto falle.
      var c = $(".card-wrap");
      if (c) c.hidden = true;
    });
})();
