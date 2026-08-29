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
        : String(v).replace("{comando}", cfg.marca.comando);
    });
    document.querySelectorAll("[data-bind-pct]").forEach(function (el) {
      var v = pick(cfg, el.getAttribute("data-bind-pct"));
      if (typeof v === "number") el.textContent = pct(v);
    });

    document.title = cfg.marca.nombre + " — " + cfg.marca.tagline;
    document.getElementById("runcmd").textContent = cfg.marca.comando;

    // tarjeta: la nota se pinta según cumpla o no el objetivo
    var t = cfg.tarjeta_ejemplo;
    var num = document.querySelector(".hc-num");
    num.style.color = t.cumplimiento >= t.objetivo ? "var(--healthy)" : "var(--burn)";

    // señales
    var ul = document.getElementById("signals");
    ul.innerHTML = "";
    t.senales.forEach(function (s) {
      var li = document.createElement("li");
      li.className = "signal-row";
      li.innerHTML =
        '<span class="signal-name"></span>' +
        '<span class="signal-bar"><span class="signal-val"></span><span class="signal-mark"></span></span>' +
        '<span class="signal-num"></span>';
      li.querySelector(".signal-name").textContent = s.nombre;
      li.querySelector(".signal-num").textContent = pct(s.valor);
      li.querySelector(".signal-mark").style.left = pct(s.objetivo);
      var bar = li.querySelector(".signal-val");
      bar.classList.add(s.valor >= s.objetivo ? "ok" : "low");
      bar.dataset.target = pct(s.valor);
      ul.appendChild(li);
    });

    // pasos
    var ol = document.getElementById("steps");
    ol.innerHTML = "";
    cfg.pasos.forEach(function (p, i) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="n"></span><h3></h3><p></p>';
      li.querySelector(".n").textContent = String(i + 1).padStart(2, "0");
      li.querySelector("h3").textContent = p.titulo;
      li.querySelector("p").textContent = p.texto;
      ol.appendChild(li);
    });

    // qué se mide
    var dl = document.getElementById("sigex");
    dl.innerHTML = "";
    cfg.senales_explicadas.forEach(function (s) {
      var d = document.createElement("div");
      d.className = "sig-item";
      d.innerHTML =
        '<dt class="sig-w"></dt><dt class="sig-n"></dt><dd class="sig-d"></dd>';
      d.querySelector(".sig-w").textContent = "×" + s.peso.toFixed(2);
      d.querySelector(".sig-n").textContent = s.nombre;
      d.querySelector(".sig-d").textContent = s.texto;
      dl.appendChild(d);
    });

    var cta = document.getElementById("ctalink");
    cta.textContent = cfg.cta.texto;
    cta.href = cfg.cta.url;

    document.getElementById("footline").textContent =
      [cfg.pie.propietario, cfg.pie.anio, cfg.pie.licencia].join(" · ");

    animar(t);
  };

  // Las barras crecen al entrar en pantalla. Con reduced-motion, aparecen ya llenas.
  var animar = function (t) {
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var llenar = function () {
      document.getElementById("budgetfill").style.width = pct(t.presupuesto_consumido);
      document.querySelectorAll(".signal-val").forEach(function (b) {
        b.style.width = b.dataset.target;
      });
    };
    if (reduce || !("IntersectionObserver" in window)) return llenar();
    var card = document.querySelector(".healthcard");
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { llenar(); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(card);
  };

  var copiar = function (cmd) {
    var btn = document.getElementById("copy");
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(cmd).then(function () {
        btn.textContent = "copiado";
        setTimeout(function () { btn.textContent = "copiar"; }, 1800);
      }, function () {
        btn.textContent = "falló";
        setTimeout(function () { btn.textContent = "copiar"; }, 1800);
      });
    });
  };

  fetch("/config.json")
    .then(function (r) {
      if (!r.ok) throw new Error("config.json respondió " + r.status);
      return r.json();
    })
    .then(function (cfg) {
      render(cfg);
      copiar(cfg.marca.comando);
    })
    .catch(function (e) {
      console.error(e);
      // La página queda con el contenido base del HTML: legible, sin datos de ejemplo.
      document.querySelector(".card-wrap").hidden = true;
    });
})();
